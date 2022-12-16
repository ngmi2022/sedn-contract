import { TransactionReceipt } from "@ethersproject/providers";
import { fetch } from "cross-fetch";
import { Wallet, ethers } from "ethers";

export const fetchConfig = async () => {
  const ENVIRONMENT = process.env.ENVIRONMENT;
  if (ENVIRONMENT === "staging") {
    return await (
      await fetch("https://storage.googleapis.com/sedn-public-config/v2.staging.config.json?avoidTheCaches=1")
    ).json();
  }
  return await (
    await fetch("https://storage.googleapis.com/sedn-public-config/v2.config.json?avoidTheCaches=1")
  ).json();
};

export const getTxCostInUSD = async (receipt: any, network: string) => {
  const config = await fetchConfig();
  let nativeAmount: string;
  // Gas price part
  switch (network) {
    case "optimism-goerli":
      nativeAmount = ethers.utils.formatEther(receipt.gasUsed); // apparently optimism-goerli is always 1 wei
      break;
    case "optimism":
      nativeAmount = ethers.utils.formatEther(receipt.effectiveGasPrice.mul(receipt.gasUsed));
      break;
    default:
      nativeAmount = ethers.utils.formatEther(receipt.effectiveGasPrice.mul(receipt.gasUsed));
  }
  console.log("TX: Native cost:", nativeAmount);

  // USD Price part
  const assetId = config.nativeAssetIds[network];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${assetId}&vs_currencies=usd`;
  const priceData = await fetch(url).then(reponse => reponse.json());
  const actualDollarValue = parseFloat(nativeAmount) * priceData[assetId].usd;
  return actualDollarValue.toString() + " USD";
};

export const checkTxStatus = async (receipt: TransactionReceipt) => {
  const logs = receipt.logs || [];
  if (typeof logs === "undefined" || logs.length === 0) {
    throw new Error("Transaction xecuted, but reverted");
  }
};

export const getTxReceipt = async (maxTimeMs: number, signer: Wallet, txHash: string) => {
  let startDate = new Date().getTime();

  const executePoll = async (resolve, reject) => {
    const txReceipt = await signer.provider.getTransactionReceipt(txHash);
    const elapsedTimeMs = new Date().getTime() - startDate;

    if (txReceipt) {
      return resolve(txReceipt);
    } else if (elapsedTimeMs > maxTimeMs) {
      return reject(new Error(`TX Receipt long to complete. Max time: ${maxTimeMs}ms`));
    } else {
      console.log(`Waiting for tx receipt. Elapsed time: ${elapsedTimeMs}ms.`);
      setTimeout(executePoll, 5000, resolve, reject);
    }
  };

  return new Promise(executePoll);
};

// Infura URL
export const getRpcUrl = (network: string) => {
  const infuraKey: string = process.env.INFURA_API_KEY as string;
  switch (network) {
    case "mainnet":
      return "https://mainnet.infura.io/v3/" + infuraKey;
    case "polygon":
      return "https://polygon-mainnet.infura.io/v3/" + infuraKey;
    case "arbitrum":
      return "https://arbitrum-mainnet.infura.io/v3/" + infuraKey;
    case "goerli":
      return "https://goerli.infura.io/v3/" + infuraKey;
    case "sepolia":
      return "https://sepolia.infura.io/v3/" + infuraKey;
    case "arbitrum-goerli":
      return "https://arbitrum-goerli.infura.io/v3/" + infuraKey;
    case "optimism":
      return "https://optimism-mainnet.infura.io/v3/" + infuraKey;
    case "optimism-goerli":
      return "https://optimism-goerli.infura.io/v3/" + infuraKey;
    default:
      throw new Error("Network not supported: Infura");
  }
};

export const explorerData: any = {
  mainnet: {
    url: "https://etherscan.com",
    api: "https://api.etherscan.io/api",
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
  polygon: {
    url: "https://polygonscan.com",
    api: "https://api.polygonscan.com/api",
    apiKey: process.env.POLYGONSCAN_API_KEY || "",
  },
  arbitrum: {
    url: "https://arbiscan.io",
    api: "https://api.arbiscan.io/api",
    apiKey: process.env.ARBISCAN_API_KEY || "",
  },
  goerli: {
    url: "https://goerli.etherscan.io",
    api: "https://api-goerli.etherscan.io/api",
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
  sepolia: {
    url: "https://sepolia.etherscan.io",
    api: "https://api-sepolia.etherscan.io/api",
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
  "arbitrum-goerli": {
    url: "https://goerli.arbiscan.io/",
    api: "https://api-goerli.arbiscan.io/api",
    apiKey: process.env.ARBISCAN_API_KEY || "",
  },
  optimism: {
    url: "https://optimistic.etherscan.io/",
    api: "https://api-optimistic.etherscan.io/",
    apiKey: process.env.OPTIMISM_API_KEY || "",
  },
  "optimism-goerli": {
    url: "https://goerli-optimism.etherscan.io/",
    api: "https://api-goerli-optimistic.etherscan.io/api",
    apiKey: process.env.OPTIMISM_API_KEY || "",
  },
};

// standardized method of getting etherscan-based abi's
export const getAbi = async (network: string, contract: string) => {
  if (explorerData[network] === undefined) {
    throw new Error("Network not supported: explorerData");
  }
  const apiUrl = explorerData[network].api;
  const apiKey = explorerData[network].apiKey;
  // console.log(`${apiUrl}?module=contract&action=getabi&address=${contract}&apikey=${apiKey}`);
  const data: any = await (
    await fetch(`${apiUrl}?module=contract&action=getabi&address=${contract}&apikey=${apiKey}`)
  ).json();
  return JSON.parse(data.result);
};

export const feeData = async (network: string, signer: Wallet) => {
  let fees: any = {};
  switch (network) {
    case "polygon":
      fees = await fetch("https://gasstation-mainnet.matic.network/v2").then(response => response.json());
      console.log("INFO: Polygon fee market is used");
      return {
        maxFee: ethers.utils.parseUnits(Math.ceil(fees.fast.maxFee) + "", "gwei"),
        maxPriorityFee: ethers.utils.parseUnits(Math.ceil(fees.fast.maxPriorityFee) + "", "gwei"),
      };
    case "matic":
      fees = await fetch("https://gasstation-mainnet.matic.network/v2").then(response => response.json());
      console.log("INFO: Polygon fee market is used");
      return {
        maxFee: ethers.utils.parseUnits(Math.ceil(fees.fast.maxFee) + "", "gwei"),
        maxPriorityFee: ethers.utils.parseUnits(Math.ceil(fees.fast.maxPriorityFee) + "", "gwei"),
      };
    default:
      const feesData = await signer.provider?.getFeeData();
      console.log("INFO: Standard fee market is used");
      return {
        maxFee: feesData.maxFeePerGas,
        maxPriorityFee: feesData.maxPriorityFeePerGas,
      };
  }
};

export const sleep = ms => new Promise(r => setTimeout(r, ms));
