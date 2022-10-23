import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import type { Sedn } from "../src/types/Sedn";
import type { MockV3Aggregator } from "../src/types/@chainlink/contracts/src/v0.8/tests/MockV3Aggregator";

type Fixture<T> = () => Promise<T>;

declare module "mocha" {
  export interface Context {
    sedn: Sedn;
    mockV3Aggregator: MockV3Aggregator;
    loadFixture: <T>(fixture: Fixture<T>) => Promise<T>;
    signers: Signers;
  }
}

export interface Signers {
  admin: SignerWithAddress;
}
