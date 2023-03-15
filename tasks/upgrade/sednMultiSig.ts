import { HardhatDefender } from "@openzeppelin/hardhat-defender";
import { ExtendedProposalResponse } from "@openzeppelin/hardhat-defender/dist/propose-upgrade";
import { getImplementationAddress } from "@openzeppelin/upgrades-core";
import { ContractFactory } from "ethers";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// actual hardhat deploy
task("upgrade:SednMultiSig").setAction(async function (taskArguments: TaskArguments) {
  // args
  const hre = taskArguments.hre;
  const proxyAddress = taskArguments.proxyAddress;
  const defender = taskArguments.defender as HardhatDefender;
  const forwarderAddress = taskArguments.forwarderAddress;
  const multiSig = taskArguments.multiSig;

  // ethers setup
  const ethers = hre.ethers;
  const network = hre.network;
  const signer = await ethers.getSigner();

  const sednFactory: ContractFactory = await ethers.getContractFactory("Sedn");
  const upgrade: ExtendedProposalResponse = await defender.proposeUpgrade(proxyAddress, sednFactory, {
    multisig: multiSig,
    constructorArgs: [forwarderAddress],
  });
  const implementationAddress = upgrade.metadata!.newImplementationAddress;

  return { proxyAddress, implementationAddress };
});
