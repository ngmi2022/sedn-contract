import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { hrtime } from "process";

import type { SednForwarder, SednForwarder__factory } from "../../src/types";

export async function deployForwarder(network: string): Promise<string> {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const forwarderAddress = await run("deploy:forwarder", { hre });
  return forwarderAddress;
}

export async function deploySedn(
  network: string,
  forwarderAddress: string,
  verifierAddress: string,
  usdcAddress: string,
) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const sednAddress = await run("deploy:Sedn", { hre, forwarderAddress, verifierAddress, usdcAddress });
  return sednAddress;
}

export async function deployTestnetSedn(
  network: string,
  forwarderAddress: string,
  verifierAddress: string,
  usdcAddress: string,
) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const sednAddress = await run("deploy:testnet", { hre, forwarderAddress, verifierAddress, usdcAddress });
  return sednAddress;
}

export async function deployTestUSDC(network: string, amountToDeploy: number) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const usdcAddress = await run("deploy:usdc", { hre, amountToDeploy });
  return usdcAddress;
}

export async function deployLogicContractWithForwarder(
  network: string,
  usdcAddress: string,
  verifierAddress: string,
  testnet: boolean,
) {
  // deploy forwarder
  const forwarderAddress = await deployForwarder(network);
  let logicAddress: string;
  if (testnet) {
    logicAddress = await deployTestnetSedn(network, forwarderAddress, verifierAddress, usdcAddress);
  } else {
    logicAddress = await deploySedn(network, forwarderAddress, verifierAddress, usdcAddress);
  }
  console.log("Process finished");
  console.log("Sedn deployed to: ", logicAddress);
  console.log("Forwarder deployed to: ", forwarderAddress);
  return { logicAddress, forwarderAddress };
}

export async function deployLogicContractWithAll(network: string, verifierAddress: string, testnet: boolean) {
  // deploy usdc (typically only for testnet)
  const usdcAddress = await deployTestUSDC(network, 100000000);
  // deploy forwarder
  const { logicAddress, forwarderAddress } = await deployLogicContractWithForwarder(
    network,
    usdcAddress,
    verifierAddress,
    testnet,
  );
  console.log("Process finished");
  console.log("Sedn deployed to: ", logicAddress);
  console.log("Forwarder deployed to: ", forwarderAddress);
  console.log("USDC deployed to: ", usdcAddress);
  return { logicAddress, forwarderAddress, usdcAddress };
}

export interface INetworksDeployWithUSDC {
  [network: string]: {
    testnet: boolean;
    usdcAddress: string;
  };
}

export interface INetworksDeploy {
  [network: string]: {
    testnet: boolean;
  };
}

export async function multiNetworkLogicDeploy(networksToDeploy: INetworksDeployWithUSDC, verifierAddress: string) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  const networks = Object.keys(networksToDeploy);
  const networksHRE = Object.keys(hre.config.networks);
  checkMissingNetworks(networks, networksHRE);
  console.log("HRE networks available:", networksHRE.join(", "));

  let config: any = {};
  for (const network of networks) {
    const { testnet, usdcAddress } = networksToDeploy[network];
    const { logicAddress, forwarderAddress } = await deployLogicContractWithForwarder(
      network,
      usdcAddress,
      verifierAddress,
      testnet,
    );
    config[network] = {
      logicContractAddress: logicAddress,
      forwarderAddress: forwarderAddress,
    };
  }
  console.log(config);
  return deployments;
}

function checkMissingNetworks(networks: string[], networksHRE: string[]) {
  const missingNetworks = networks.filter(network => !networksHRE.includes(network));
  if (missingNetworks.length) {
    const errorMessage = `The following networks are not available in config: ${missingNetworks.join(", ")}`;
    throw new Error(errorMessage);
  }
}

const networksToDeploy: INetworksDeployWithUSDC = {
  "arbitrum-goerli": {
    testnet: true,
    usdcAddress: "0xa30d67979d4ce07b5467533b633ad23285434c4a",
  },
  "optimism-goerli": {
    testnet: true,
    usdcAddress: "0x8DC32778b81f7C2A537647CCf7fac2F8BC713f9C",
  },
};

const deployments = multiNetworkLogicDeploy(networksToDeploy, "0xe0c2eE53925fBe98319ac1f5653677e551E10AD7");
