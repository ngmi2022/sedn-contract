import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Sign } from "crypto";
import { BigNumber, Wallet } from "ethers";
import { ethers } from "ethers";

import ABI from "../artifacts/contracts/Sedn/Sedn.sol/Sedn.json";
import { Sedn } from "../src/types/contracts/Sedn/Sedn.sol/Sedn";

export class FakeSigner {
  signer: Wallet | SignerWithAddress;
  sedn: Sedn;

  constructor(signer: Wallet | SignerWithAddress, sednContractAddress: string) {
    this.signer = signer;
    this.sedn = new ethers.Contract(sednContractAddress, ABI.abi, signer) as Sedn;
  }

  getAddress() {
    return this.signer.address;
  }

  async signMessage(receiver: string, till: number, secret: string) {
    const message = ethers.utils.solidityKeccak256(["address", "uint256", "bytes32"], [receiver, till, secret]);
    return await this.signer.signMessage(ethers.utils.arrayify(message));
  }
}

export default FakeSigner;
