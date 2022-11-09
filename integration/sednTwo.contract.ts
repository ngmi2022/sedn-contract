import { SednTwo } from './../src/types/contracts/SednTwo.sol/SednTwo';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import  { ethers } from 'hardhat';
import { Signer } from 'ethers';
import { Contract } from 'ethers';
export const deployContract = async <ContractType extends Contract>(
    contractName: string,
    args: any[],
    signer?: Signer
  ): Promise<ContractType> => {
    return (await (
      await ethers.getContractFactory(contractName, signer)
    ).deploy(...args)) as ContractType;
  };

  export const deploySednTwo = async (
    args: string[],
    signer: SignerWithAddress
  ): Promise<SednTwo> => {
    return deployContract("SednTwo", args, signer);
  };
  