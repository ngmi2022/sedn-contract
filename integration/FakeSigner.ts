import { BigNumber } from 'ethers';
import { ethers } from 'ethers';
import { SednTwo } from './../src/types/contracts/SednTwo.sol/SednTwo';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import ABI from "../../sedn-contract/artifacts/contracts/SednTwo.sol/SednTwo.json";

export class FakeSigner {
    signer: SignerWithAddress;
    sedn: SednTwo;

    constructor(signer: SignerWithAddress, sednTwoContractAddress: string) {
        this.signer = signer;
        this.sedn = new ethers.Contract(sednTwoContractAddress, ABI.abi, signer) as SednTwo;
    }

    getAddress() {
        return this.signer.address;
    }

    async getNonce() {
        return await this.sedn.nonce()
    }

    async signMessage(amount: BigNumber, receiver: string, till: number, secret: string) {
        const nonce = await this.getNonce();
        const message = ethers.utils.solidityKeccak256(
            ["uint256", "address", "uint256", "string", "uint256"],
            [amount, receiver, till, secret, nonce]
        );
        return await this.signer.signMessage(ethers.utils.arrayify(message));
    }
}

export default FakeSigner;