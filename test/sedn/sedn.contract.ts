import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Signer } from "ethers";
import { Contract } from "ethers";
import { ethers } from "hardhat";

import { SednForwarder } from "../../src/types";
import { Sedn } from "../../src/types/contracts/Sedn/Sedn.sol/Sedn";

export const deployContract = async <ContractType extends Contract>(
  contractName: string,
  args: any[],
  signer?: Signer,
): Promise<ContractType> => {
  return (await (await ethers.getContractFactory(contractName, signer)).deploy(...args)) as ContractType;
};

export const deploySedn = async (args: string[], signer: SignerWithAddress): Promise<Sedn> => {
  return deployContract("Sedn", args, signer);
};

export const deploySednForwarder = async (args: string[], signer: SignerWithAddress): Promise<SednForwarder> => {
  return deployContract("SednForwarder", args, signer);
};
