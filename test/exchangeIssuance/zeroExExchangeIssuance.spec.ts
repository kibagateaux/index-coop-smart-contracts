import "module-alias/register";

import { Address, Account, ZeroExOrder } from "@utils/types";
import { ADDRESS_ZERO, MAX_UINT_256, MAX_UINT_96, MAX_INT_256 } from "@utils/constants";
import { ZeroExExchangeIssuance, StandardTokenMock, WETH9 } from "@utils/contracts/index";
import {  UniswapV2Router02 } from "@utils/contracts/uniswap";
import { SetToken } from "@utils/contracts/setV2";
import DeployHelper from "@utils/deploys";
import {
  cacheBeforeEach,
  ether,
  getAccounts,
  getLastBlockTimestamp,
  getSetFixture,
  getUniswapFixture,
  getWaffleExpect,
} from "@utils/index";
import { UnitsUtils } from "@utils/common/unitsUtils";
import { SetFixture } from "@utils/fixtures";
import { UniswapFixture } from "@utils/fixtures";
import { BigNumber, ContractTransaction, PopulatedTransaction } from "ethers";
import {
  getAllowances,
} from "@utils/common/exchangeIssuanceUtils";

const expect = getWaffleExpect();


describe("ZeroExExchangeIssuance", async () => {
  let owner: Account;
  let user: Account;
  let externalPositionModule: Account;
  let setV2Setup: SetFixture;

  let deployer: DeployHelper;
  let setToken: SetToken;
  let setTokenWithWeth: SetToken;

  let exchangeIssuance: ZeroExExchangeIssuance;

  cacheBeforeEach(async () => {
    [
      owner,
      user,
      externalPositionModule,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);

    setV2Setup = getSetFixture(owner.address);
    await setV2Setup.initialize();

    const daiUnits = BigNumber.from("23252699054621733");
    const wbtcUnits = UnitsUtils.wbtc(1);
    setToken = await setV2Setup.createSetToken(
      [setV2Setup.dai.address, setV2Setup.wbtc.address],
      [daiUnits, wbtcUnits],
      [setV2Setup.issuanceModule.address, setV2Setup.streamingFeeModule.address]
    );

    await setV2Setup.issuanceModule.initialize(setToken.address, ADDRESS_ZERO);

    const wethUnits = ether(0.5);
    setTokenWithWeth = await setV2Setup.createSetToken(
      [setV2Setup.dai.address, setV2Setup.weth.address],
      [daiUnits, wethUnits],
      [setV2Setup.issuanceModule.address, setV2Setup.streamingFeeModule.address]
    );

    await setV2Setup.issuanceModule.initialize(setTokenWithWeth.address, ADDRESS_ZERO);
  });

  describe("#constructor", async () => {
    let controllerAddress: Address;
    let basicIssuanceModuleAddress: Address;

    cacheBeforeEach(async () => {
      controllerAddress = setV2Setup.controller.address;
      basicIssuanceModuleAddress = setV2Setup.issuanceModule.address;
    });

    async function subject(): Promise<ZeroExExchangeIssuance> {
      return await deployer.extensions.deployZeroExExchangeIssuance(
        owner.address,
        controllerAddress,
        basicIssuanceModuleAddress
      );
    }

    it("verify state set properly via constructor", async () => {
      const exchangeIssuanceContract: ZeroExExchangeIssuance = await subject();

      const expectedControllerAddress = await exchangeIssuanceContract.setController();
      expect(expectedControllerAddress).to.eq(controllerAddress);

      const expectedBasicIssuanceModuleAddress = await exchangeIssuanceContract.basicIssuanceModule();
      expect(expectedBasicIssuanceModuleAddress).to.eq(basicIssuanceModuleAddress);
    });

    context("when exchange issuance is deployed", async () => {
      let uniswapRouter: UniswapV2Router02;
      let sushiswapRouter: UniswapV2Router02;
      let indexCoopTreasury: Address;
      let controllerAddress: Address;
      let basicIssuanceModuleAddress: Address;

      let weth: WETH9;
      let wbtc: StandardTokenMock;
      let dai: StandardTokenMock;
      let usdc: StandardTokenMock;
      let illiquidToken: StandardTokenMock;
      let setTokenIlliquid: SetToken;
      let setTokenExternal: SetToken;

      cacheBeforeEach(async () => {
        let uniswapSetup: UniswapFixture;
        let sushiswapSetup: UniswapFixture;

        indexCoopTreasury = owner.address;

        weth = setV2Setup.weth;
        wbtc = setV2Setup.wbtc;
        dai = setV2Setup.dai;
        usdc = setV2Setup.usdc;
        illiquidToken = await deployer.setV2.deployTokenMock(owner.address, ether(1000000), 18, "illiquid token", "RUGGED");


        usdc.transfer(user.address, UnitsUtils.usdc(10000));
        weth.transfer(user.address, UnitsUtils.ether(1000));

        const daiUnits = ether(0.5);
        const illiquidTokenUnits = ether(0.5);
        setTokenIlliquid = await setV2Setup.createSetToken(
          [setV2Setup.dai.address, illiquidToken.address],
          [daiUnits, illiquidTokenUnits],
          [setV2Setup.issuanceModule.address, setV2Setup.streamingFeeModule.address]
        );
        await setV2Setup.issuanceModule.initialize(setTokenIlliquid.address, ADDRESS_ZERO);

        setTokenExternal = await setV2Setup.createSetToken(
          [setV2Setup.dai.address],
          [ether(0.5)],
          [setV2Setup.issuanceModule.address, setV2Setup.streamingFeeModule.address]
        );
        await setV2Setup.issuanceModule.initialize(setTokenExternal.address, ADDRESS_ZERO);

        const controller = setV2Setup.controller;
        await controller.addModule(externalPositionModule.address);
        await setTokenExternal.addModule(externalPositionModule.address);
        await setTokenExternal.connect(externalPositionModule.wallet).initializeModule();

        await setTokenExternal.connect(externalPositionModule.wallet).addExternalPositionModule(
          dai.address,
          externalPositionModule.address
        );

        uniswapSetup = await getUniswapFixture(owner.address);
        await uniswapSetup.initialize(owner, weth.address, wbtc.address, dai.address);
        sushiswapSetup = await getUniswapFixture(owner.address);
        await sushiswapSetup.initialize(owner, weth.address, wbtc.address, dai.address);

        uniswapRouter = uniswapSetup.router;
        sushiswapRouter = sushiswapSetup.router;
        controllerAddress = setV2Setup.controller.address;
        basicIssuanceModuleAddress = setV2Setup.issuanceModule.address;

        await sushiswapSetup.createNewPair(weth.address, wbtc.address);
        await uniswapSetup.createNewPair(weth.address, dai.address);
        await sushiswapSetup.createNewPair(wbtc.address, usdc.address);

        // ETH-WBTC pools
        await wbtc.approve(uniswapRouter.address, MAX_UINT_256);
        await uniswapRouter.connect(owner.wallet).addLiquidityETH(
          wbtc.address,
          UnitsUtils.wbtc(100000),
          MAX_UINT_256,
          MAX_UINT_256,
          owner.address,
          (await getLastBlockTimestamp()).add(1),
          { value: ether(100), gasLimit: 9000000 }
        );

        // cheaper wbtc compared to uniswap
        await wbtc.approve(sushiswapRouter.address, MAX_UINT_256);
        await sushiswapRouter.connect(owner.wallet).addLiquidityETH(
          wbtc.address,
          UnitsUtils.wbtc(200000),
          MAX_UINT_256,
          MAX_UINT_256,
          owner.address,
          (await getLastBlockTimestamp()).add(1),
          { value: ether(100), gasLimit: 9000000 }
        );

        // ETH-DAI pools
        await dai.approve(uniswapRouter.address, MAX_INT_256);
        await uniswapRouter.connect(owner.wallet).addLiquidityETH(
          dai.address,
          ether(100000),
          MAX_UINT_256,
          MAX_UINT_256,
          owner.address,
          (await getLastBlockTimestamp()).add(1),
          { value: ether(10), gasLimit: 9000000 }
        );


        // Verify that 0x routes orders not possible by ExchangeIssuanceV2

        // WBTC-USDC pools
        // cheaper WBTC than on ETH pools
        await usdc.connect(owner.wallet).approve(sushiswapRouter.address, MAX_INT_256);
        await sushiswapRouter.connect(owner.wallet).addLiquidity(
          wbtc.address,
          usdc.address,
          UnitsUtils.wbtc(300000),
          UnitsUtils.usdc(100000),
          MAX_UINT_256,
          MAX_UINT_256,
          owner.address,
          (await getLastBlockTimestamp()).add(1),
          { gasLimit: 9000000 }
        );

        // USDC-DAI pools
        await dai.approve(sushiswapRouter.address, MAX_INT_256);
        await usdc.approve(sushiswapRouter.address, MAX_INT_256);
        await sushiswapRouter.connect(owner.wallet).addLiquidity(
          usdc.address,
          dai.address,
          UnitsUtils.usdc(100000),
          ether(100000),
          MAX_UINT_256,
          MAX_UINT_256,
          owner.address,
          (await getLastBlockTimestamp()).add(1),
          { gasLimit: 9000000 }
        );

        exchangeIssuance = await deployer.extensions.deployZeroExExchangeIssuance(
          indexCoopTreasury,
          controllerAddress,
          basicIssuanceModuleAddress
        );
      });

      describe("#approveToken", async () => {

        let subjectTokenToApprove: StandardTokenMock;

        beforeEach(async () => {
          subjectTokenToApprove = setV2Setup.dai;
        });

        async function subject(): Promise<ContractTransaction> {
          return await exchangeIssuance.approveToken(subjectTokenToApprove.address);
        }

        it("should update the approvals correctly", async () => {
          const spenders = [basicIssuanceModuleAddress];
          const tokens = [subjectTokenToApprove];

          await subject();

          const finalAllowances = await getAllowances(tokens, exchangeIssuance.address, spenders);
          const expectedAllowance = MAX_UINT_96;

          for (let i = 0; i < finalAllowances.length; i++) {
            const actualAllowance = finalAllowances[i];
            expect(actualAllowance).to.eq(expectedAllowance);
          }
        });
      });

      describe("#approveTokens", async () => {
        let subjectTokensToApprove: StandardTokenMock[];

        beforeEach(async () => {
          subjectTokensToApprove = [setV2Setup.dai, setV2Setup.wbtc];
        });

        async function subject(): Promise<ContractTransaction> {
          return await exchangeIssuance.approveTokens(subjectTokensToApprove.map(token => token.address));
        }

        it("should update the approvals correctly", async () => {
          const spenders = [basicIssuanceModuleAddress];

          await subject();

          const finalAllowances = await getAllowances(subjectTokensToApprove, exchangeIssuance.address, spenders);
          const expectedAllowance = MAX_UINT_96;

          for (let i = 0; i < finalAllowances.length; i++) {
            const actualAllowance = finalAllowances[i];
            expect(actualAllowance).to.eq(expectedAllowance);
          }
        });
      });

      describe("#approveSetToken", async () => {
        let subjectSetToApprove: SetToken | StandardTokenMock;

        beforeEach(async () => {
          subjectSetToApprove = setToken;
        });

        async function subject(): Promise<ContractTransaction> {
          return await exchangeIssuance.approveSetToken(subjectSetToApprove.address);
        }

        it("should update the approvals correctly", async () => {
          const spenders = [basicIssuanceModuleAddress];
          const tokens = [dai, wbtc];

          await subject();

          const finalAllowances = await getAllowances(tokens, exchangeIssuance.address, spenders);
          const expectedAllowance = MAX_UINT_96;

          for (let i = 0; i < finalAllowances.length; i++) {
            const actualAllowance = finalAllowances[i];
            expect(actualAllowance).to.eq(expectedAllowance);
          }
        });

        context("when the input token is not a set", async () => {
          beforeEach(async () => {
            subjectSetToApprove = usdc;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("ExchangeIssuance: INVALID SET");
          });
        });

        context("when the set contains an external position", async () => {
          beforeEach(async () => {
            subjectSetToApprove = setTokenExternal;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("ExchangeIssuance: EXTERNAL_POSITIONS_NOT_ALLOWED");
          });
        });
      });

      describe("#issueSetForExactToken", async () => {
        let subjectCaller: Account;
        let subjectSetToken: SetToken;
        let subjectInputToken: StandardTokenMock | WETH9;
        let subjectAmountInput: BigNumber;
        let subjectMinSetReceive: BigNumber;

        const initializeSubjectVariables = () => {
          subjectCaller = user;
          subjectSetToken = setToken; // DAI + WBTC
          subjectInputToken = usdc;
          subjectAmountInput = UnitsUtils.usdc(1000);
          subjectMinSetReceive = ether(0);
        };

        cacheBeforeEach(async () => {
          initializeSubjectVariables();
          await exchangeIssuance.approveSetToken(subjectSetToken.address);
          await subjectInputToken.connect(subjectCaller.wallet).approve(exchangeIssuance.address, MAX_UINT_256);
        });

        beforeEach(initializeSubjectVariables);

        async function subject(): Promise<any> {
          // Mock 0x data with known liquidity pool settings above
          const exchanges = {
            [wbtc.address]: sushiswapRouter,
            [dai.address]: uniswapRouter,
          };
          const paths = {
            [wbtc.address]: [subjectInputToken.address, wbtc.address],
            [dai.address]: [subjectInputToken.address, weth.address, dai.address],
          };

          const setComponents = await setToken.getComponents();

          const orders: ZeroExOrder[] = await Promise.all(
            setComponents.map(async (addr: Address) => {
              const componentUnitsPerSetToken = (await setToken.getDefaultPositionRealUnit(addr)).div(ether(1));
              const tx: PopulatedTransaction = await exchanges[addr]
                .populateTransaction
                .swapTokensForExactTokens(
                  subjectMinSetReceive.mul(componentUnitsPerSetToken),
                  subjectAmountInput,
                  paths[addr],
                  exchanges[addr].address,
                  (await getLastBlockTimestamp()).add(1),
                  { gasLimit: 900000000 }
                );

              return {
                componentTraded: addr,
                exchange: exchanges[addr].address,
                tradeData: tx.data,
                callValue: BigNumber.from(0),
              } as ZeroExOrder;
            })
          );

          console.log("0x issuance orders", orders);

          return await exchangeIssuance.connect(subjectCaller.wallet).issueSetForExactToken(
            setToken.address,
            subjectInputToken.address,
            subjectAmountInput,
            subjectMinSetReceive,
            orders,
            { gasLimit: 9000000 }
          );
        }

        it("should issue the correct amount of Set to the caller", async () => {
          const initialBalanceOfSet = await subjectSetToken.balanceOf(subjectCaller.address);
          // TODO: can't use V2 estimation functions because they can't predict not WETH trading values
          const expectedOutputOfSet = subjectMinSetReceive;

          await subject();

          const finalSetBalance = await subjectSetToken.balanceOf(subjectCaller.address);
          const expectedSetBalance = initialBalanceOfSet.add(expectedOutputOfSet);
          expect(finalSetBalance).to.eq(expectedSetBalance);
        });
      });
    });
  });
});
