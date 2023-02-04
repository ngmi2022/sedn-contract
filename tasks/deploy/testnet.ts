import { ContractFactory } from "ethers";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// actual hardhat deploy
task("deploy:testnet").setAction(async function (taskArguments: TaskArguments) {
  // args
  const hre = taskArguments.hre;
  const verifierAddress = taskArguments.verifierAddress;
  const trustedForwarderAddress = taskArguments.forwarderAddress;
  const usdcAddress = taskArguments.usdcAddress;

  // ethers setup
  const ethers = hre.ethers;
  const network = hre.network;
  const signer = await ethers.getSigner();

  const registryAddress: string = "0xc30141B657f4216252dc59Af2e7CdB9D8792e1B0"; // mainnet registry address, could really be anything
  const sednFactory = (await ethers.getContractFactory("SednTestnet")) as ContractFactory;
  const sedn = await sednFactory
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
