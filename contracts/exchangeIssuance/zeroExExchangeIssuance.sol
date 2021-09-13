/*
    Copyright 2021 Titans Of Data
    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
    SPDX-License-Identifier: Apache License, Version 2.0
*/

pragma solidity 0.6.10;
pragma experimental ABIEncoderV2;

/* ============ Libraries ============= */
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { Math } from "@openzeppelin/contracts/math/Math.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { PreciseUnitMath } from "../lib/PreciseUnitMath.sol";

/* ============ Interfaces ============= */
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IBasicIssuanceModule } from "../interfaces/IBasicIssuanceModule.sol";
import { IController } from "../interfaces/IController.sol";
import { ISetToken } from "../interfaces/ISetToken.sol";

/**
 * @title ExchangeIssuance
 * @author Index Coop
 *
 * Contract for issuing and redeeming any SetToken using ETH or an ERC20 as the paying/receiving currency.
 * All swaps are done using the best price found on Uniswap or Sushiswap.
 *
 */
contract ZeroExExchangeIssuance is ReentrancyGuard {

    using Address for address payable;
    using SafeMath for uint256;
    using PreciseUnitMath for uint256;
    using SafeERC20 for IERC20;
    using SafeERC20 for ISetToken;

    /* ============ Constants ============= */

    uint256 constant private MAX_UINT96 = 2**96 - 1;
    address constant public ETH_ADDRESS = address(0);
    address public treasury; // FEEDBACK: get appropriate address

    /* ============ State Variables ============ */
    IController public immutable setController;
    IBasicIssuanceModule public immutable basicIssuanceModule;

    /* ============ Structs ============ */
    struct ZeroExOrder {
      IERC20 componentTraded;
      address payable exchange;
      bytes tradeData;
      uint256 callValue;
    }

    /* ============ Events ============ */

    event ExchangeIssue(
        address indexed _recipient,     // The recipient address of the issued SetTokens
        ISetToken indexed _setToken,    // The issued SetToken
        IERC20 indexed _inputToken,     // The address of the input asset(ERC20/ETH) used to issue the SetTokens
        uint256 _amountInputToken,      // The amount of input tokens used for issuance
        uint256 _amountSetIssued        // The amount of SetTokens received by the recipient
    );

    event ExchangeRedeem(
        address indexed _recipient,     // The recipient address which redeemed the SetTokens
        ISetToken indexed _setToken,    // The redeemed SetToken
        IERC20 indexed _outputToken,    // The address of output asset(ERC20/ETH) received by the recipient
        uint256 _amountSetRedeemed,     // The amount of SetTokens redeemed for output tokens
        uint256 _amountOutputToken      // The amount of output tokens received by the recipient
    );

    event Refund(
        address indexed _recipient,     // The recipient address which redeemed the SetTokens
        uint256 _refundAmount           // The amount of ETH redunded to the recipient
    );

    /* ============ Modifiers ============ */

    modifier isSetToken(ISetToken _setToken) {
         require(setController.isSet(address(_setToken)), "ExchangeIssuance: INVALID SET");
         _;
    }

    /* ============ Constructor ============ */

    constructor(
        address _treasury,
        IController _setController,
        IBasicIssuanceModule _basicIssuanceModule
    )
        public
    {
        treasury = _treasury;
        setController = _setController;
        basicIssuanceModule = _basicIssuanceModule;
    }

    /* ============ Public Functions ============ */

    /**
     * Runs all the necessary approval functions required for a given ERC20 token.
     * This function can be called when a new token is added to a SetToken during a
     * rebalance.
     *
     * @param _token    Address of the token which needs approval
     */
    function approveToken(IERC20 _token) public {
        _safeApprove(_token, address(basicIssuanceModule), MAX_UINT96);
    }

    /**
     * Runs all the necessary approval functions required for a list of ERC20 tokens.
     *
     * @param _tokens    Addresses of the tokens which need approval
     */
    function approveTokens(IERC20[] calldata _tokens) external {
        for (uint256 i = 0; i < _tokens.length; i++) {
            approveToken(_tokens[i]);
        }
    }

    /**
     * Runs all the necessary approval functions required before issuing
     * or redeeming a SetToken. This function need to be called only once before the first time
     * this smart contract is used on any particular SetToken.
     *
     * @param _setToken    Address of the SetToken being initialized
     */

    // Doesn't this have to be called whenever a token is added to a SetToken as well?
    function approveSetToken(ISetToken _setToken) isSetToken(_setToken) external {
        address[] memory components = _setToken.getComponents();
        for (uint256 i = 0; i < components.length; i++) {
            // Check that the component does not have external positions
            require(
                _setToken.getExternalPositionModules(components[i]).length == 0,
                "ExchangeIssuance: EXTERNAL_POSITIONS_NOT_ALLOWED"
            );
            approveToken(IERC20(components[i]));
        }
    }

    /**
     * Issues SetTokens for an exact amount of input ERC20 tokens.
     * The ERC20 token must be approved by the sender to this contract.
     * If ERC20 address = 0x0 treat as raw ETH
     *
     * @param _setToken         Address of the SetToken being issued
     * @param _inputToken       Address of input token
     * @param _amountInput      Amount of the input token / ether to spend
     * @param _minSetReceive    Minimum amount of SetTokens to receive. Prevents unnecessary slippage.
     * @param _orders           Order data for each component. Provided by 0x API 
     *
     * @return setTokenAmount   Amount of SetTokens issued to the caller
     */
    function issueSetForExactToken(
        ISetToken _setToken,
        IERC20 _inputToken,
        uint256 _amountInput,
        uint256 _minSetReceive,
        ZeroExOrder[] memory _orders
    )
        isSetToken(_setToken)
        external
        payable
        nonReentrant
        returns (uint256)
    {
        require(_amountInput > 0, "ExchangeIssuance: INVALID INPUTS");

        require(_orders.length == _setToken.getComponents().length, "ExchangeIssuance: INVALID ORDERS");

        bool isETH = address(_inputToken) == ETH_ADDRESS;
        if(isETH) {
          require(msg.value >= _amountInput,  "ExchangeIssuance: INSUFFICIENT_INPUT_AMOUNT");
        } else {
          _inputToken.safeTransferFrom(msg.sender, address(this), _amountInput);
        }

        for(uint256 i; i < _orders.length; i++) {
          ZeroExOrder memory order = _orders[i];

          _safeApprove(_inputToken, order.exchange, MAX_UINT96); 
          order.exchange.functionCallWithValue(order.tradeData, order.callValue);
        }

        // FEEDBACK: can calculate max Set issuance amount or can give min and keep tokens for ourselves
        basicIssuanceModule.issue(_setToken, _minSetReceive, msg.sender);

        emit ExchangeIssue(msg.sender, _setToken, _inputToken, _amountInput, _minSetReceive);
        return _minSetReceive;
    }

    /**
     * Redeems an exact amount of SetTokens for an ERC20 token.
     * The SetToken must be approved by the sender to this contract.
     * If ERC20 address = 0x0 treat as raw ETH
     * @param _setToken             Address of the SetToken being redeemed
     * @param _outputToken          Address of output token
     * @param _amountSetToken       Amount SetTokens to redeem
     * @param _minOutputReceive     Minimum amount of output token to receive
     * @param _orders               Order data for each component. Provided by 0x API 
     *
     * @return outputAmount         Amount of output tokens sent to the caller
     */
    function redeemExactSetForToken(
        ISetToken _setToken,
        IERC20 _outputToken,
        uint256 _amountSetToken,
        uint256 _minOutputReceive,
        ZeroExOrder[] memory _orders
    )
        isSetToken(_setToken)
        external
        payable
        nonReentrant
        returns (uint256)
    {
        require(_amountSetToken > 0, "ExchangeIssuance: INVALID INPUTS");
        require(_orders.length == _setToken.getComponents().length, "ExchangeIssuance: INVALID ORDERS");

        bool isETH = address(_outputToken) == ETH_ADDRESS;
        uint256 existingOutputBalance = isETH ?
          address(this).balance.sub(msg.value) :
          _outputToken.balanceOf(address(this));
        
        _redeemExactSet(_setToken, _amountSetToken);
        
        for(uint256 i; i < _orders.length; i++) {
          ZeroExOrder memory order = _orders[i];
          _safeApprove(order.componentTraded, order.exchange, MAX_UINT96);
          order.exchange.functionCallWithValue(order.tradeData, order.callValue);
        }

        uint256 outputAmount = isETH ?
          address(this).balance.sub(existingOutputBalance) :
          _outputToken.balanceOf(address(this)).sub(existingOutputBalance);

        require(outputAmount >= _minOutputReceive, "ExchangeIssuance: INSUFFICIENT_OUTPUT_AMOUNT");

        // keep outputAmount.sub(_minOutputReceive) as positive slippage profit for coop
        if(isETH) {
          (payable(msg.sender)).sendValue(_minOutputReceive);
        } else {
          _outputToken.safeTransfer(msg.sender, _minOutputReceive);
        }

        emit ExchangeRedeem(msg.sender, _setToken, _outputToken, _amountSetToken, _minOutputReceive);
        return _minOutputReceive;
    }


    /**
    * Sends tokens held in contract from positive slippage trades to Index Coop treasury
    *
    * @param _token          Address of the token to withdraw to Index Coop treasury
    *
    * @return amount         Amount of tokens withdrawn
    */
    function withdrawExcessTokens(IERC20 _token) external returns (uint256) {
      uint256 amount = _token.balanceOf(address(this));
      _token.safeTransfer(treasury, amount);
      return amount;
    }

    /**
    * Sends ETH held in contract from positive slippage trades to Index Coop treasury
    *
    * @return amount         Amount of tokens withdrawn
    */
    function withdrawExcessEth() external returns (uint256) {
      uint256 amount = address(this).balance;
      (payable(treasury)).sendValue(amount);
      return amount;
    }

  /**
    * Updates the address that excess tokens get sent to
    *
    * @return _treasury         New address to send all tokens to
    */
    function updateTreasury(address _treasury) external returns (bool) {
      require(treasury == msg.sender, "ExchangeIssuance: INVALID TREAUSURER");
      treasury = _treasury;
      return true;
    }

    /* ============ Internal Functions ============ */

    /**
     * Sets a max approval limit for an ERC20 token, provided the current allowance
     * is less than the required allownce.
     *
     * @param _token    Token to approve
     * @param _spender  Spender address to approve
     */
    function _safeApprove(IERC20 _token, address _spender, uint256 _requiredAllowance) internal {
      if(address(_token) != address(0)) {
        uint256 allowance = _token.allowance(address(this), _spender);
        if (allowance < _requiredAllowance) {
            _token.safeIncreaseAllowance(_spender, MAX_UINT96 - allowance);
        }
      }
    }

    /**
     * Redeems a given amount of SetToken.
     *
     * @param _setToken     Address of the SetToken to be redeemed
     * @param _amount       Amount of SetToken to be redeemed
     */
    function _redeemExactSet(ISetToken _setToken, uint256 _amount) internal returns (uint256) {
        _setToken.safeTransferFrom(msg.sender, address(this), _amount);
        basicIssuanceModule.redeem(_setToken, _amount, address(this));
    }
}
