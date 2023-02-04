import { addresses } from "@socket.tech/ll-core/addresses/index";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

import type { Sedn, Sedn__factory } from "../../src/types";

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

task("deploy:Sedn").setAction(async function (taskArguments: TaskArguments) {
  // args
  const hre = taskArguments.hre;
  const verifierAddress = taskArguments.verifierAddress;
  const trustedForwarderAddress = taskArguments.forwarderAddress;
  const usdcAddress = taskArguments.usdcAddress;

  // ethers setup
  const ethers = hre.ethers;
  const network = hre.network;
  const signer = await ethers.getSigner();
  // constructor & deploy setup
  const registryAddress: string =
    hre.network.config.chainId !== 31337
      ? addresses[hre.network.config.chainId]["registry"]
      : "0xc30141B657f4216252dc59Af2e7CdB9D8792e1B0";
  const sednFactory: Sedn__factory = await ethers.getContractFactory("Sedn");
  const sedn: Sedn = await sednFactory
    .connect(signer)
    .deploy(usdcAddress, registryAddress, verifierAddress, trustedForwarderAddress);
  await sedn.deployed();
  console.log("Sedn deployed to: ", sedn.address);

  if (network.name !== "hardhat") {
    // Verify contract on Etherscan
    await timeout(60000); // We may have to wait a bit until etherscan can read the contract
    await hre.run("verify:verify", {
      address: sedn.address,
      network: network.name,
      constructorArguments: [usdcAddress, registryAddress, verifierAddress, trustedForwarderAddress],
    });
  }
  return sedn.address;
});
