import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { addresses } from "@socket.tech/ll-core/addresses/index";
import fetch from "cross-fetch";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

import type { Sedn, Sedn__factory } from "../../src/types";

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const getConfig = async () => {
  const data: any = await (await fetch("https://storage.googleapis.com/sedn-public-config/config.json")).json();
  return data;
};

task("deploy:Sedn").setAction(async function (taskArguments: TaskArguments, { ethers, run, network }) {
  const signers: SignerWithAddress[] = await ethers.getSigners();
  const registry: string = "registry";
  const ch_id: number = network.config.chainId!;
  const registryAddress: string =
    ch_id !== 31337 ? addresses[ch_id][registry] : "0xc30141B657f4216252dc59Af2e7CdB9D8792e1B0";
  const sednFactory: Sedn__factory = await ethers.getContractFactory("Sedn");
  const configData = await getConfig();
  const name = "SednUSDC";
  const symbol = "sdnUSDC";
  const trustedForwarder = configData.forwarder[network.name];
  const verifier = configData.verifier;
  const sedn: Sedn = await sednFactory
    .connect(signers[0])
    .deploy(configData.usdc[network.name].contract, registryAddress, verifier, name, symbol, trustedForwarder);
  await sedn.deployed();
  console.log("Sedn deployed to: ", sedn.address);

  if (network.name !== "hardhat") {
    // Verify contract on Etherscan
    await timeout(60000); // We may have to wait a bit until etherscan can read the contract
    await run("verify:verify", {
      address: sedn.address,
      network: network.name,
      constructorArguments: [
        configData.usdc[network.name].contract,
        registryAddress,
        verifier,
        name,
        symbol,
        trustedForwarder,
      ],
    });
  }
});
