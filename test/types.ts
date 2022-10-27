import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { Sedn } from "../src/types";

type Fixture<T> = () => Promise<T>;

declare module "mocha" {
  export interface Context {
    sedn: Sedn;
    loadFixture: <T>(fixture: Fixture<T>) => Promise<T>;
    signers: Signers;
  }
}

export interface Signers {
  admin: SignerWithAddress;
}
