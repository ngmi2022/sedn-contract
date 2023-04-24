import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Sign } from "crypto";
import { BigNumber, Wallet } from "ethers";
import { ethers } from "ethers";

import ABI from "../../sedn-contract/artifacts/contracts/Sedn.sol/Sedn.json";
import { Sedn } from "./../src/types/contracts/Sedn.sol/Sedn";

export class FakeSigner {
  signer: Wallet;
  sedn: Sedn;

  constructor(signer: Wallet, sednContractAddress: string) {
    this.signer = signer;
    this.sedn = new ethers.Contract(sednContractAddress, ABI.abi, signer) as Sedn;
  }

  getAddress() {
    return this.signer.address;
  }

  async getNonce() {
    return await this.sedn.nonce();
  }

  async signMessage(amount: BigNumber, receiver: string, till: number, secret: string) {
    const nonce = await this.getNonce();
    const message = ethers.utils.solidityKeccak256(
      ["uint256", "address", "uint256", "bytes32", "uint256"],
      [amount, receiver, till, secret, nonce],
    );
    return await this.signer.signMessage(ethers.utils.arrayify(message));
  }
}

export default FakeSigner;
