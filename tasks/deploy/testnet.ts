import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import fetch from "cross-fetch";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

import { SednTestnet, SednTestnet__factory } from "../../src/types";

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// gets public SednC config dict
const config = async () => {
  const configData: any = await (
    await fetch("https://storage.googleapis.com/sedn-public-config/v2.config.json")
  ).json();
  return configData;
};

// actual hardhat deploy
task("deploy:testnet").setAction(async function (taskArguments: TaskArguments, { ethers, run, network }) {
  const signers: SignerWithAddress[] = await ethers.getSigners();
  const configData = await config();
  const registryAddress: string = "0xc30141B657f4216252dc59Af2e7CdB9D8792e1B0"; // mainnet registry address, could really be anything
  const sednFactory: SednTestnet__factory = await ethers.getContractFactory("SednTestnet");
  const name = "SednUSDC";
  const symbol = "sdnUSDC";
  const trustedForwarder = configData.forwarder[network.name];
  const verifier = configData.verifier;
  const usdcTokenAddress = configData.usdc[network.name].contract;
  const sedn: SednTestnet = await sednFactory
    .connect(signers[0])
    .deploy(usdcTokenAddress, registryAddress, verifier, name, symbol, trustedForwarder);
  await sedn.deployed();
  console.log("Sedn deployed to: ", sedn.address);

  if (network.name !== "hardhat") {
    // Verify contract on Etherscan
    await timeout(60000); // We may have to wait a bit until etherscan can read the contract
    await run("verify:verify", {
      address: sedn.address,
      network: network.name,
      constructorArguments: [usdcTokenAddress, registryAddress, verifier, name, symbol, trustedForwarder],
    });
  }
});
