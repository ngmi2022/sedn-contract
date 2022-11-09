import { Sedn } from '../src/types/contracts/Sedn.sol/Sedn';
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

  export const deploySedn = async (
    args: string[],
    signer: SignerWithAddress
  ): Promise<Sedn> => {
    return deployContract("Sedn", args, signer);
  };
  