import { getImplementationAddress } from "@openzeppelin/upgrades-core";
import { ContractFactory } from "ethers";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// actual hardhat deploy
task("upgrade:SednPropose").setAction(async function (taskArguments: TaskArguments) {
  // args
  const hre = taskArguments.hre;
  const proxyAddress = taskArguments.proxyAddress;
  const forwarderAddress = taskArguments.forwarderAddress;
  const multiSig = taskArguments.multiSig;
  const defender = taskArguments.defender;

  // ethers setup
  const ethers = hre.ethers;
  const network = hre.network;
  const signer = await ethers.getSigner();

  const sednFactory: ContractFactory = await ethers.getContractFactory("Sedn");
  const upgrade = await defender.proposeUpgrade(proxyAddress, sednFactory, {
    call: { fn: "setPause", args: [false] },
    constructorArgs: [forwarderAddress],
    multisig: multiSig,
  });
  const implementationAddress = upgrade.metadata.newImplementationAddress;
  console.log("Upgraded Sedn proxy at: ", upgrade.contract.address);
  if (network.name !== "hardhat") {
    try {
      // Verify contract on Etherscan
      await timeout(60000); // We may have to wait a bit until etherscan can read the contract
      await hre.run("verify:verify", {
        address: implementationAddress,
        constructorArguments: [forwarderAddress],
      });
    } catch (err) {
      console.log("Error verifying contract on Etherscan: ", (err as Error).message);
    }
  }

  return { proxyAddress: upgrade.contract.address, implementationAddress };
});
