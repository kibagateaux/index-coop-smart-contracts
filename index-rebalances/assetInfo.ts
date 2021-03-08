import "module-alias/register";

import { BigNumber } from "@ethersproject/bignumber";
import { Address } from "@utils/types";
import { ether } from "@utils/common/index";

interface AssetInfo {
  id: string,
  address: Address,
  price: BigNumber
}

export interface Assets {
  [symbol: string]: AssetInfo;
}


export const assets: Assets = {
  YFI: {
    id: "yfi",
    address: "0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e",
    price: ether(34277.97) ,
  },
  COMP: {
    id: "compound",
    address: "0xc00e94Cb662C3520282E6f5717214004A7f26888",
    price: ether(452.22),
  },
  SNX: {
    id: "snx",
    address: "0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F",
    price: ether(20.8),
  },
  MKR: {
    id: "maker",
    address: "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2",
    price: ether(2248.90),
  },
  REN: {
    id: "ren",
    address: "0x408e41876cCCDC0F92210600ef50372656052a38",
    price: ether(1.17),
  },
  KNC: {
    id: "kyber-network",
    address: "0xdd974D5C2e2928deA5F71b9825b8b646686BD200",
    price: ether(1.68),
  },
  LRC: {
    id: "loopring",
    address: "0xBBbbCA6A901c926F240b89EacB641d8Aec7AEafD",
    price: ether(0.578754),
  },
  BAL: {
    id: "balancer",
    address: "0xba100000625a3754423978a60c9317c58a424e3D",
    price: ether(37.87),
  },
  UNI: {
    id: "uniswap",
    address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    price: ether(24.62),
  },
  AAVE: {
    id: "aave",
    address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
    price: ether(377.36),
  },
  MTA: {
    id: "mta",
    address: "0xa3BeD4E1c75D00fa6f4E5E6922DB7261B5E9AcD2",
    price: ether(2.03),
  },
  WETH: {
    id: "",
    address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    price: ether(1543.20),
  },
  SUSHI: {
    id: "sushi",
    address: "0x6b3595068778dd592e39a122f4f5a5cf09c90fe2",
    price: ether(17.01)
  } 
};