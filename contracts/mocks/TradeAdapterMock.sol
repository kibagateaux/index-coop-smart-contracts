pragma solidity 0.6.10;
pragma experimental ABIEncoderV2;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * Trade Adapter that doubles as a mock exchange
 */
contract TradeAdapterMock {

    /* ============ Helper Functions ============ */

    function withdraw(address _token)
        external
    {
        uint256 balance = ERC20(_token).balanceOf(address(this));
        require(ERC20(_token).transfer(msg.sender, balance), "ERC20 transfer failed");
    }

    /* ============ Trade Functions ============ */

    function trade(
        address _sourceToken,
        address _destinationToken,
        address _destinationAddress,
        uint256 _sourceQuantity,
        uint256 _minDestinationQuantity
    )
        external
    {
        uint256 destinationBalance = ERC20(_destinationToken).balanceOf(address(this));
        require(ERC20(_sourceToken).transferFrom(_destinationAddress, address(this), _sourceQuantity), "ERC20 TransferFrom failed");
        require(ERC20(_destinationToken).transfer(_destinationAddress, destinationBalance), "ERC20 transfer failed");
    }

    /* ============ Adapter Functions ============ */

    function getSpender()
        external
        view
        returns (address)
    {
        return address(this);
    }

    function getTradeCalldata(
        address _sourceToken,
        address _destinationToken,
        address _destinationAddress,
        uint256 _sourceQuantity,
        uint256 _minDestinationQuantity,
        bytes memory /* _data */
    )
        external
        view
        returns (address, uint256, bytes memory)
    {
        // Encode method data for SetToken to invoke
        bytes memory methodData = abi.encodeWithSignature(
            "trade(address,address,address,uint256,uint256)",
            _sourceToken,
            _destinationToken,
            _destinationAddress,
            _sourceQuantity,
            _minDestinationQuantity
        );

        return (address(this), 0, methodData);
    }
}