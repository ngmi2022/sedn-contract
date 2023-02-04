import { run } from "hardhat";
import { upgrades } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

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
  const { implementationAddress, proxyAddress } = await run("deploy:Sedn", {
    hre,
    upgrades,
    forwarderAddress,
    verifierAddress,
    usdcAddress,
  });
  return { implementationAddress, proxyAddress };
}

export async function deployTestnetSedn(
  network: string,
  forwarderAddress: string,
  verifierAddress: string,
  usdcAddress: string,
) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const { implementationAddress, proxyAddress } = await run("deploy:testnet", {
    hre,
    forwarderAddress,
    verifierAddress,
    usdcAddress,
  });
  return { implementationAddress, proxyAddress };
}

export async function deployTestUSDC(network: string, amountToDeploy: number) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const usdcAddress = await run("deploy:usdc", { hre, amountToDeploy });
  return usdcAddress;
}

export async function deploySednWithForwarder(
  network: string,
  usdcAddress: string,
  verifierAddress: string,
  testnet: boolean,
) {
  // deploy forwarder
  const forwarderAddress = await deployForwarder(network);
  let addresses: any = {
    implementationAddress: "",
    proxyAddress: "",
  };
  if (testnet) {
    addresses = await deployTestnetSedn(network, forwarderAddress, verifierAddress, usdcAddress);
  } else {
    addresses = await deploySedn(network, forwarderAddress, verifierAddress, usdcAddress);
  }
  console.log("Sedn deployed to: ", addresses.proxyAddress);
  console.log("Implementation contract deployed to: ", addresses.implementationAddress);
  console.log("Forwarder deployed to: ", forwarderAddress);
  console.log("Process finished");
  return {
    implementationAddress: addresses.implementationAddress,
    proxyAddress: addresses.proxyAddress,
    forwarderAddress,
  };
}

export async function deploySednWithAll(network: string, verifierAddress: string, testnet: boolean) {
  // deploy usdc (typically only for testnet)
  const usdcAddress = await deployTestUSDC(network, 100000000);
  console.log("USDC deployed to: ", usdcAddress);
  // deploy forwarder
  const { implementationAddress, proxyAddress, forwarderAddress } = await deploySednWithForwarder(
    network,
    usdcAddress,
    verifierAddress,
    testnet,
  );
  return { implementationAddress, proxyAddress, forwarderAddress, usdcAddress };
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
    const { implementationAddress, proxyAddress, forwarderAddress } = await deploySednWithForwarder(
      network,
      usdcAddress,
      verifierAddress,
      testnet,
    );
    config[network] = {
      implementationContractAddress: implementationAddress,
      proxyContractAddress: proxyAddress,
      forwarderContractAddress: forwarderAddress,
    };
  }
  console.log(config);
  return config;
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

const promise = deploySedn(
  "arbitrum-goerli",
  "0x47b80475A1A4832a0dcbBc206E24Ddf6533aE2Bb",
  "0xe0c2eE53925fBe98319ac1f5653677e551E10AD7",
  "0xA30D67979d4Ce07b5467533B633AD23285434C4A",
);
