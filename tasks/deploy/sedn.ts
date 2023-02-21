import { getImplementationAddress } from "@openzeppelin/upgrades-core";
import { addresses } from "@socket.tech/ll-core/addresses/index";
import { sign } from "crypto";
import { ContractFactory } from "ethers";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

import { feeData, getRpcUrl } from "../../helper/utils";

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

task("deploy:Sedn").setAction(async function (taskArguments: TaskArguments) {
  // args
  const hre = taskArguments.hre;
  const verifierAddress = taskArguments.verifierAddress;
  const trustedForwarderAddress = taskArguments.forwarderAddress;
  const usdcAddress = taskArguments.usdcAddress;
  const upgrades = taskArguments.upgrades;
  // ethers setup
  const ethers = hre.ethers;
  const network = hre.network;
  const signer = await ethers.getSigner();
  const provider = new ethers.providers.JsonRpcProvider(getRpcUrl(network.name));
  const providerNew = new ethers.providers.FallbackProvider([ethers.provider], 1);
  const fees = await feeData(network.name, signer);
  const feesOld = await provider.getFeeData();
  const combinedFees = { ...feesOld, maxFeePerGas: fees.maxFee, maxPriorityFeePerGas: fees.maxPriorityFee };
  providerNew.getFeeData = async () => combinedFees;
  const wallet = ethers.Wallet.fromMnemonic(process.env.MNEMONIC as string).connect(providerNew);

  // constructor & deploy setup
  const registryAddress: string =
    hre.network.config.chainId !== 31337
      ? addresses[hre.network.config.chainId]["registry"]
      : "0xc30141B657f4216252dc59Af2e7CdB9D8792e1B0";
  const sednFactory: ContractFactory = await ethers.getContractFactory("Sedn", wallet);
  const sednArgs = [usdcAddress, registryAddress, verifierAddress, trustedForwarderAddress];
  const proxy = await upgrades.deployProxy(sednFactory, sednArgs, {
    kind: "uups",
    constructorArgs: [trustedForwarderAddress],
    initializer: "initSedn",
  });
  await proxy.deployed();
  const implementationAddress = await getImplementationAddress(signer.provider, proxy.address);
  console.log("Sedn deployed to: ", proxy.address);
  console.log("Sedn implementation deployed to: ", implementationAddress);

  if (network.name !== "hardhat") {
    // Verify contract on Etherscan
    await timeout(60000); // We may have to wait a bit until etherscan can read the contract
    await hre.run("verify:verify", {
      address: proxy.address,
      constructorArguments: [trustedForwarderAddress],
    });
  }
  return { implementationAddress, proxyAddress: proxy.address };
});
