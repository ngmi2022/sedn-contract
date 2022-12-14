/* eslint @typescript-eslint/no-var-requires: "off" */
import { TransactionReceipt } from "@ethersproject/providers";
import { assert, expect } from "chai";
import exp from "constants";
import fetch from "cross-fetch";
import { BigNumber, Contract, Wallet, ethers } from "ethers";
import { text } from "stream/consumers";

import { FakeSigner } from "../../integration/FakeSigner";
import { sendMetaTx } from "./helper/signer";

const ENVIRONMENT = process.env.ENVIRONMENT || "prod";
const USE_STARGATE = process.env.USE_STARGATE === "true" ? true : false;

const fetchConfig = async () => {
  if (ENVIRONMENT === "staging") {
    return await (await fetch("https://storage.googleapis.com/sedn-public-config/v2.staging.config.json")).json();
  }
  return await (await fetch("https://storage.googleapis.com/sedn-public-config/v2.config.json")).json();
};

// some params & functions to facilitate metaTX testing / testnet
const gasless: boolean = process.env.CONTEXT === "github" ? true : false;
// const testnet: boolean = process.env.TESTNET === "TRUE" ? true : false; // we need to include this in workflow
const testnet = true;
// no testnets need to be included
const networksToTest = testnet ? ["arbitrum-goerli"] : ["polygon", "arbitrum", "optimism"]; // TODO: add optimism-goerli

const relayers: any = {
  prod: {
    polygon:
      "https://api.defender.openzeppelin.com/autotasks/507b3f04-18d3-41ab-9484-701a01fc2ffe/runs/webhook/b070ed2b-ef2a-41d4-b249-7945f96640a3/PjcQDaaG11CYHoJJ1Khcj3",
    arbitrum:
      "https://api.defender.openzeppelin.com/autotasks/8e4e19b7-0103-4552-ab68-3646966ab186/runs/webhook/b070ed2b-ef2a-41d4-b249-7945f96640a3/Th57r6KwhiVCjTbJmUwBHa",
    "arbitrum-goerli":
      "https://api.defender.openzeppelin.com/autotasks/ce515ed3-d267-4654-8843-e9fe7047c05d/runs/webhook/b070ed2b-ef2a-41d4-b249-7945f96640a3/NifTewFznuMPfh9t5ehvQ7",
    optimism:
      "https://api.defender.openzeppelin.com/autotasks/eabbed25-d5bf-42d1-aa5e-e2a79760a071/runs/webhook/b070ed2b-ef2a-41d4-b249-7945f96640a3/4DaUMzTN4vcYz3iP12ZTRp",
    "optimism-goerli":
      "https://api.defender.openzeppelin.com/autotasks/0bfccce8-3489-411f-8fe2-38bb7e84104c/runs/webhook/b070ed2b-ef2a-41d4-b249-7945f96640a3/Vi5WiebBpX1VXi15azTMj5",
  },
  staging: {
    polygon:
      "https://api.defender.openzeppelin.com/autotasks/ee577506-d647-4919-819e-bbe70e60f58c/runs/webhook/b070ed2b-ef2a-41d4-b249-7945f96640a3/T1z3MPJi1MmiGgvfooB98s",
    arbitrum:
      "https://api.defender.openzeppelin.com/autotasks/dba1d31c-cae3-4205-9786-5c2cf22c46af/runs/webhook/b070ed2b-ef2a-41d4-b249-7945f96640a3/KvtntGhEgoeVhCKA4jmFem",
    "arbitrum-goerli":
      "https://api.defender.openzeppelin.com/autotasks/2d858f46-cc71-4628-af9f-efade0f6b1df/runs/webhook/b070ed2b-ef2a-41d4-b249-7945f96640a3/DSL3dXteoJuVmagoSrD4Fv",
    optimism:
      "https://api.defender.openzeppelin.com/autotasks/a123ebb6-4801-4a81-af03-7fd7d3b242a7/runs/webhook/b070ed2b-ef2a-41d4-b249-7945f96640a3/Q6A8rTPELU4GdsMKWRyBr4",
    "optimism-goerli":
      "https://api.defender.openzeppelin.com/autotasks/f8d5a078-9408-4ab9-a390-8e94a83c53d2/runs/webhook/b070ed2b-ef2a-41d4-b249-7945f96640a3/7WpJSECEPRHpNiEums4W5A",
  },
};

// Infura URL
const getRpcUrl = (network: string) => {
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

// Etherscan data
const explorerData: any = {
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

const nativeAssetIds: any = {
  mainnet: "ethereum",
  polygon: "matic-network",
  arbitrum: "ethereum",
  "arbitrum-goerli": "ethereum",
  aurora: "ethereum",
  avalanche: "avalanche-2",
  fantom: "fantom",
  optimism: "ethereum",
  "optimism-goerli": "ethereum",
};

// necessary relayer balance for each network, NOT IN BIG NUMBER, BUT FLOATS
const minRelayerBalance: any = {
  mainnet: 0.05,
  polygon: 1,
  arbitrum: 0.01,
  "arbitrum-goerli": 0.01,
  aurora: 0.0,
  avalanche: 0.25,
  fantom: 1,
  optimism: 0.01,
  "optimism-goerli": 0.01,
};

// TODO: get this shit into helper functions
export const feeData = async (network: string, signer: Wallet) => {
  switch (network) {
    case "polygon":
      const fees = await fetch("https://gasstation-mainnet.matic.network/v2").then(response => response.json());
      return {
        maxFee: ethers.utils.parseUnits(Math.ceil(fees.fast.maxFee) + "", "gwei"),
        maxPriorityFee: ethers.utils.parseUnits(Math.ceil(fees.fast.maxPriorityFee) + "", "gwei"),
      };
    default:
      const feesData = await signer.provider?.getFeeData();
      return {
        maxFee: feesData.maxFeePerGas,
        maxPriorityFee: feesData.maxPriorityFeePerGas,
      };
  }
};

// standardized method of getting etherscan-based abi's
const getAbi = async (network: string, contract: string) => {
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

const getRandomRecipientNetwork = async (fromNetwork: string) => {
  const networks = networksToTest.filter(network => network !== fromNetwork);
  const randomIndex = Math.floor(Math.random() * networks.length);
  return networks[randomIndex];
};

describe("Sedn Contract", function () {
  async function getSedn(network: string) {
    let config = await fetchConfig();
    const sednContract = config.contracts[network];

    // TODO: support other providers
    const provider = new ethers.providers.JsonRpcProvider(getRpcUrl(network));
    const signer = new ethers.Wallet(process.env.SENDER_PK || "", provider);
    const verifier = new ethers.Wallet(process.env.VERIFIER_PK || "", provider);
    const recipient = new ethers.Wallet(process.env.RECIPIENT_PK || "", provider);
    // Get Sedn
    const sedn = new ethers.Contract(sednContract, await getAbi(network, sednContract), signer);
    const usdcOrigin = new ethers.Contract(
      config.usdc[network].contract,
      await getAbi(network, config.usdc[network].abi),
      signer,
    );
    return { sedn, usdcOrigin, signer, verifier, config, recipient };
  }
  networksToTest.forEach(function (network) {
    describe(`Funding for wallets ${network}`, function () {
      let usdcOrigin: Contract;
      let signer: Wallet;
      let recipient: Wallet;
      let config: any;
      it(`should find relayers funded with Native and Test Wallets funded with USDC on ${network}`, async function () {
        const deployed = await getSedn(network);
        usdcOrigin = deployed.usdcOrigin;
        signer = deployed.signer;
        recipient = deployed.recipient;
        config = deployed.config;

        // RELAYER CHECKS
        const relayerBalance: number = parseFloat(
          (await signer.provider.getBalance(config.relayer[network])).toString(),
        );
        // console.log("Relayer Balance", relayerBalance, minRelayerBalance[network]);
        expect(relayerBalance).to.be.gt(minRelayerBalance[network]);

        // SENDER CHECKS
        const senderBalance = await usdcOrigin.balanceOf(signer.address);
        const senderNative: number = parseFloat((await signer.provider.getBalance(signer.address)).toString());
        // console.log("Sender Balance", senderBalance.toString());
        expect(senderBalance).to.be.gt(ethers.utils.parseUnits("10", "mwei")); // TBD
        // console.log("senderNative", senderNative, minRelayerBalance[network]);
        expect(senderNative).to.be.gt(minRelayerBalance[network]);

        // RECIPIENT CHECKS
        const recipientBalance = await usdcOrigin.balanceOf(recipient.address);
        const recipientNative: number = parseFloat((await signer.provider.getBalance(recipient.address)).toString());
        // console.log("recipient Balance", recipientBalance.toString());
        expect(recipientBalance).to.be.gt(ethers.utils.parseUnits("10", "mwei")); // TBD
        // console.log("recipientNative", recipientNative, minRelayerBalance[network]);
        expect(recipientNative).to.be.gt(minRelayerBalance[network]);
      });
    });
  });
  networksToTest.forEach(function (network) {
    describe(`Sedn on ${network}`, function () {
      let sedn: Contract;
      let usdcOrigin: Contract;
      let signer: Wallet;
      let recipient: Wallet;
      let trusted: FakeSigner;
      let config: any;
      let explorerUrl: string;
      let decDivider: number;
      let nativeAssetId: string;
      let amount: number;
      beforeEach(async function () {
        const deployed = await getSedn(network);
        sedn = deployed.sedn;
        usdcOrigin = deployed.usdcOrigin;
        signer = deployed.signer;
        config = deployed.config;
        recipient = deployed.recipient;
        explorerUrl = explorerData[network].url;
        decDivider = parseInt(10 ** (await usdcOrigin.decimals()) + "");
        nativeAssetId = nativeAssetIds[network];
        amount = parseInt(parseFloat(process.env.AMOUNT! || "1.00") * decDivider + "");

        trusted = new FakeSigner(deployed.verifier, sedn.address);
        if (trusted.getAddress() !== deployed.config.verifier) {
          const error = new Error(
            `Using the wrong verifier: expected ${deployed.config.verifier} got ${trusted.getAddress()}`,
          );
          console.error(error);
          throw error;
        }
      });
      it("should send funds to a registered user", async function () {
        // check allowance & if necessary increase approve
        const allowance = parseInt((await usdcOrigin.allowance(signer.address, sedn.address)).toString());
        if (allowance < amount) {
          const approve = await usdcOrigin.connect(signer).approve(sedn.address, amount);
          await approve.wait();
        }
        // send
        const usdcBeforeSednSigner = await usdcOrigin.balanceOf(signer.address); // should be at least 10
        const usdcBeforeSednContract = await usdcOrigin.balanceOf(sedn.address);
        const sednBeforeSednSigner = await sedn.balanceOf(signer.address);
        // TODO: put this shit in helper so its not duplicated
        const tx = await sedn.connect(signer).sednKnown(amount, signer.address); // send amount to signer itself
        await tx.wait();
        const usdcAfterSednSigner = await usdcOrigin.balanceOf(signer.address);
        const usdcAfterSednContract = await usdcOrigin.balanceOf(sedn.address);
        const sednAfterSednSigner = await sedn.balanceOf(signer.address);

        // all three balances are checked; contract USDC, signer USDC and signer Sedn
        expect(usdcBeforeSednSigner.sub(usdcAfterSednSigner)).to.equal(amount);
        expect(usdcAfterSednContract.sub(usdcBeforeSednContract)).to.equal(amount);
        expect(sednAfterSednSigner.sub(sednBeforeSednSigner)).to.equal(amount);
      });
      it("should send funds to an unregistered user", async function () {
        // check allowance & if necessary increase approve
        const allowance = parseInt((await usdcOrigin.allowance(signer.address, sedn.address)).toString());
        if (allowance < amount) {
          const approve = await usdcOrigin.connect(signer).approve(sedn.address, amount);
          await approve.wait();
        }
        // send
        const usdcBeforeSednSigner = await usdcOrigin.balanceOf(signer.address);
        const usdcBeforeSednContract = await usdcOrigin.balanceOf(sedn.address);
        const sednBeforeClaimRecipient = await sedn.balanceOf(recipient.address);
        const solution = (Math.random() + 1).toString(36).substring(7);
        const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
        console.log(`INFO: Running with solution '${solution}' and secret '${secret}'`);
        // TODO: put this shit in helper so its not duplicated
        const txSedn = await sedn.connect(signer).sednUnknown(amount, secret);
        await txSedn.wait();

        // check sending
        const usdcAfterSednSigner = await usdcOrigin.balanceOf(signer.address);
        const usdcAfterSednContract = await usdcOrigin.balanceOf(sedn.address);
        expect(usdcBeforeSednSigner.sub(usdcAfterSednSigner)).to.equal(amount);
        expect(usdcAfterSednContract.sub(usdcBeforeSednContract)).to.equal(amount);

        // claim
        const till = parseInt(new Date().getTime().toString().slice(0, 10)) + 1000;
        const signedMessage = await trusted.signMessage(BigNumber.from(amount), recipient.address, till, secret);
        const signature = ethers.utils.splitSignature(signedMessage);
        // TODO: get this shit into signer.ts
        if (gasless === true) {
          const response = await sendMetaTx(
            sedn,
            recipient,
            process.env.RECIPIENT_PK || "",
            "claim",
            [solution, secret, till, signature.v, signature.r, signature.s],
            BigInt("0"),
            relayers[ENVIRONMENT][network],
            config.forwarder[network],
          );
          const txHash = JSON.parse(response.result).txHash;
          console.log(`TX: Send tx: ${explorerUrl}/tx/${txHash}`);
          const txReceipt: any = await getTxReceipt(60_000, signer, txHash);
          console.log(`TX: Executed send tx with txHash: ${txHash} and blockHash: ${txReceipt.blockHash}`);
        } else {
          let fees = await feeData(network, signer);
          const tx = await sedn
            .connect(recipient)
            .claim(solution, secret, till, signature.v, signature.r, signature.s, {
              maxFeePerGas: fees.maxFee,
              maxPriorityFeePerGas: fees.maxPriorityFee,
            });
          console.log(`TX: Send tx: ${explorerUrl}/tx/${tx.hash}`);
          const receipt = await tx.wait();
          console.log("TX: executed send tx", await getTxCostInUSD(receipt, nativeAssetId));
        }

        // check claim
        const sednAfterClaimRecipient = await sedn.balanceOf(recipient.address);
        expect(sednAfterClaimRecipient.sub(sednBeforeClaimRecipient)).to.equal(amount);
      });
      it("should transfer funds to an unregistered user", async function () {
        // check and adapt funding balances of signer
        const sednBalanceSigner = parseInt((await sedn.connect(signer).balanceOf(signer.address)).toString()); // make sure its number
        const sednBalanceRecipient = parseInt((await sedn.connect(signer).balanceOf(recipient.address)).toString()); // make sure its number
        let useSigner = signer;
        let useRecipient = recipient;
        if (sednBalanceSigner < amount) {
          if (sednBalanceRecipient > amount) {
            // swap signer and recipient
            useSigner = recipient;
            useRecipient = signer;
          } else {
            // check allowance & if necessary increase approve
            const allowance = parseInt((await usdcOrigin.allowance(signer.address, sedn.address)).toString());
            if (allowance < amount) {
              const approve = await usdcOrigin.connect(signer).approve(sedn.address, amount);
              await approve.wait();
            }
            const txSend = await sedn.connect(signer).sednKnown(amount, signer.address); // fund signer w/o testing
            await txSend.wait();
          }
        }

        // transfer
        const sednBeforeTransferSigner = await sedn.balanceOf(useSigner.address);
        const solution = (Math.random() + 1).toString(36).substring(7);
        const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
        console.log(`INFO: Running with solution '${solution}' and secret '${secret}'`);
        // TODO: get this shit into signer.ts
        if (gasless === true) {
          const response = await sendMetaTx(
            sedn,
            useSigner,
            useSigner.privateKey,
            "transferUnknown",
            [amount, secret],
            BigInt("0"),
            relayers[ENVIRONMENT][network],
            config.forwarder[network],
          );
          const txHash = JSON.parse(response.result).txHash;
          console.log(`TX: Send tx: ${explorerUrl}/tx/${txHash}`);
          const txReceipt: any = await getTxReceipt(60_000, signer, txHash);
          console.log(`TX: Executed send tx with txHash: ${txHash} and blockHash: ${txReceipt.blockHash}`);
        } else {
          let fees = await feeData(network, signer);
          const tx = await sedn.connect(useSigner).transferUnknown(amount, secret, {
            maxFeePerGas: fees.maxFee,
            maxPriorityFeePerGas: fees.maxPriorityFee,
          });
          console.log(`TX: Send tx: ${explorerUrl}/tx/${tx.hash}`);
          const receipt = await tx.wait();
          console.log("TX: executed send tx", await getTxCostInUSD(receipt, nativeAssetId));
        }
        const sednAfterTransferSigner = await sedn.balanceOf(useSigner.address);
        expect(sednBeforeTransferSigner.sub(sednAfterTransferSigner)).to.equal(amount);

        // claim
        const sednBeforeClaimRecipient = await sedn.balanceOf(useRecipient.address);
        const till = parseInt(new Date().getTime().toString().slice(0, 10)) + 1000;
        const signedMessage = await trusted.signMessage(BigNumber.from(amount), recipient.address, till, secret);
        const signature = ethers.utils.splitSignature(signedMessage);
        // TODO: get this shit into signer.ts
        if (gasless === true) {
          const response = await sendMetaTx(
            sedn,
            useRecipient,
            useRecipient.privateKey,
            "claim",
            [solution, secret, till, signature.v, signature.r, signature.s],
            BigInt("0"),
            relayers[ENVIRONMENT][network],
            config.forwarder[network],
          );
          const txHash = JSON.parse(response.result).txHash;
          console.log(`TX: Send tx: ${explorerUrl}/tx/${txHash}`);
          const txReceipt: any = await getTxReceipt(60_000, signer, txHash);
          console.log(`TX: Executed send tx with txHash: ${txHash} and blockHash: ${txReceipt.blockHash}`);
        } else {
          let fees = await feeData(network, useRecipient);
          const tx = await sedn
            .connect(useRecipient)
            .claim(solution, secret, till, signature.v, signature.r, signature.s, {
              maxFeePerGas: fees.maxFee,
              maxPriorityFeePerGas: fees.maxPriorityFee,
            });
          console.log(`TX: Send tx: ${explorerUrl}/tx/${tx.hash}`);
          const receipt = await tx.wait();
          console.log("TX: executed send tx", await getTxCostInUSD(receipt, nativeAssetId));
        }
        const sednAfterClaimRecipient = await sedn.balanceOf(useRecipient.address);
        expect(sednAfterClaimRecipient.sub(sednBeforeClaimRecipient)).to.equal(amount);
      });
      it("should transfer funds to a registered user", async function () {
        // check and adapt funding balances of signer
        const sednBalanceSigner = parseInt((await sedn.connect(signer).balanceOf(signer.address)).toString()); // make sure its number
        const sednBalanceRecipient = parseInt((await sedn.connect(signer).balanceOf(recipient.address)).toString()); // make sure its number
        let useSigner = signer;
        let useRecipient = recipient;
        if (sednBalanceSigner < amount) {
          if (sednBalanceRecipient > amount) {
            // swap signer and recipient
            useSigner = recipient;
            useRecipient = signer;
          } else {
            // check allowance & if necessary increase approve
            const allowance = parseInt((await usdcOrigin.allowance(signer.address, sedn.address)).toString());
            if (allowance < amount) {
              const approve = await usdcOrigin.connect(signer).approve(sedn.address, amount);
              await approve.wait();
            }
            const txSedn = await sedn.connect(signer).sednKnown(amount, signer.address); // fund signer w/o testing
            await txSedn.wait();
          }
        }

        // transfer
        const sednBeforeTransferSigner = await sedn.balanceOf(useSigner.address);
        const sednBeforeTransferRecipient = await sedn.balanceOf(useRecipient.address);
        const solution = (Math.random() + 1).toString(36).substring(7);
        const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
        console.log(`INFO: Running with solution '${solution}' and secret '${secret}'`);
        // TODO: get this shit into signer.ts
        if (gasless === true) {
          const response = await sendMetaTx(
            sedn,
            useSigner,
            useSigner.privateKey,
            "transferKnown",
            [amount, useRecipient.address],
            BigInt("0"),
            relayers[ENVIRONMENT][network],
            config.forwarder[network],
          );
          const txHash = JSON.parse(response.result).txHash;
          console.log(`TX: Send tx: ${explorerUrl}/tx/${txHash}`);
          const txReceipt: any = await getTxReceipt(60_000, signer, txHash);
          console.log(`TX: Executed send tx with txHash: ${txHash} and blockHash: ${txReceipt.blockHash}`);
        } else {
          let fees = await feeData(network, signer);
          const tx = await sedn.connect(useSigner).transferKnown(amount, useRecipient.address, {
            maxFeePerGas: fees.maxFee,
            maxPriorityFeePerGas: fees.maxPriorityFee,
          });
          console.log(`TX: Send tx: ${explorerUrl}/tx/${tx.hash}`);
          const receipt = await tx.wait();
          console.log("TX: executed send tx", await getTxCostInUSD(receipt, nativeAssetId));
        }
        const sednAfterTransferSigner = await sedn.balanceOf(useSigner.address);
        const sednAfterTransferRecipient = await sedn.balanceOf(useRecipient.address);
        expect(sednBeforeTransferSigner.sub(sednAfterTransferSigner)).to.equal(amount);
        expect(sednAfterTransferRecipient.sub(sednBeforeTransferRecipient)).to.equal(amount);
      });
      it("should withdraw funds to a given address", async function () {
        // check and adapt funding balances of signer
        const sednBalanceSigner = parseInt((await sedn.connect(signer).balanceOf(signer.address)).toString()); // make sure its number
        const sednBalanceRecipient = parseInt((await sedn.connect(signer).balanceOf(recipient.address)).toString()); // make sure its number
        let useSigner = signer;
        let useRecipient = recipient;
        if (sednBalanceSigner < amount) {
          if (sednBalanceRecipient > amount) {
            // swap signer and recipient
            useSigner = recipient;
            useRecipient = signer;
          } else {
            // check allowance & if necessary increase approve
            const allowance = parseInt((await usdcOrigin.allowance(signer.address, sedn.address)).toString());
            if (allowance < amount) {
              const approve = await usdcOrigin.connect(signer).approve(sedn.address, amount);
              await approve.wait();
            }
            const txSedn = await sedn.connect(signer).sednKnown(amount, signer.address); // fund signer w/o testing
            await txSedn.wait();
          }
        }
        // withdraw
        const sednBeforeWithdrawSigner = await sedn.balanceOf(useSigner.address);
        const usdcBeforeWithdrawSigner = await usdcOrigin.balanceOf(useSigner.address);
        // TODO: get this shit into signer.ts
        if (gasless === true) {
          const response = await sendMetaTx(
            sedn,
            useSigner,
            useSigner.privateKey,
            "withdraw",
            [amount],
            BigInt("0"),
            relayers[ENVIRONMENT][network],
            config.forwarder[network],
          );
          const txHash = JSON.parse(response.result).txHash;
          console.log(`TX: Send tx: ${explorerUrl}/tx/${txHash}`);
          const txReceipt: any = await getTxReceipt(60_000, signer, txHash);
          console.log(`TX: Executed send tx with txHash: ${txHash} and blockHash: ${txReceipt.blockHash}`);
        } else {
          let fees = await feeData(network, signer);
          const tx = await sedn.connect(useSigner).withdraw(amount, {
            maxFeePerGas: fees.maxFee,
            maxPriorityFeePerGas: fees.maxPriorityFee,
          });
          console.log(`TX: Send tx: ${explorerUrl}/tx/${tx.hash}`);
          const receipt = await tx.wait();
          console.log("TX: executed send tx", await getTxCostInUSD(receipt, nativeAssetId));
        }
        const sednAfterWithdrawSigner = await sedn.balanceOf(useSigner.address);
        const usdcAfterWithdrawSigner = await usdcOrigin.balanceOf(useSigner.address);
        expect(sednBeforeWithdrawSigner.sub(sednAfterWithdrawSigner)).to.equal(amount);
        expect(usdcAfterWithdrawSigner.sub(usdcBeforeWithdrawSigner)).to.equal(amount);
      });
      // we need to figure out how we can specify the "only" keyword for a
      // single test on live-chains to ensure that we don't piss too much gas
      it("should send funds to an unregistered user who claims it on a different chain", async function () {
        // ensure funding
        const sednBalanceSigner = parseInt((await sedn.connect(signer).balanceOf(signer.address)).toString()); // make sure its number
        const sednBalanceRecipient = parseInt((await sedn.connect(signer).balanceOf(recipient.address)).toString()); // make sure its number
        let useSigner = signer;
        let useRecipient = recipient;
        if (sednBalanceSigner < amount) {
          if (sednBalanceRecipient > amount) {
            // swap signer and recipient
            useSigner = recipient;
            useRecipient = signer;
          } else {
            // check allowance & if necessary increase approve
            const allowance = parseInt((await usdcOrigin.allowance(signer.address, sedn.address)).toString());
            if (allowance < amount) {
              const approve = await usdcOrigin.connect(signer).approve(sedn.address, amount);
              await approve.wait();
            }
            const txSedn = await sedn.connect(signer).sednKnown(amount, signer.address); // fund signer w/o testing
            await txSedn.wait();
          }
        }

        // /**********************************
        // Setup of DESTINATION
        // *************************************/
        const destinationNetwork = testnet ? network : await getRandomRecipientNetwork(network); // only test on testnet as no bridges possible
        const destinationProvider = new ethers.providers.JsonRpcProvider(getRpcUrl(destinationNetwork));
        const destinationRecipient = new ethers.Wallet(useSigner.privateKey, destinationProvider);
        const usdcDestination = new ethers.Contract(
          config.usdc[destinationNetwork].contract,
          await getAbi(destinationNetwork, config.usdc[destinationNetwork].abi),
          destinationRecipient,
        );

        console.log(
          `INFO: Withdrawing ${amount / decDivider} USDC from SednBalance of ${useSigner.address} (${network}) to ${
            destinationRecipient.address
          } (${destinationNetwork})`,
        );

        // /**********************************
        // Get the Bungee/Socket Route
        // *************************************/

        // GATEKEEPER FOR STARGATE
        let excludeBridges = "stargate";
        if (amount > 10 ** decDivider) {
          excludeBridges = "";
        }

        const socketRouteRequest = {
          fromChain: testnet ? "polygon" : network,
          toChain: testnet ? "arbitrum" : destinationNetwork,
          recipientAddress: destinationRecipient.address,
          amount: amount / decDivider,
          excludeBridges: excludeBridges,
          useStargate: USE_STARGATE,
          environment: ENVIRONMENT,
        };

        const socketRouteResponse: any = await fetch(
          "https://us-central1-sedn-17b18.cloudfunctions.net/getSednParameters/",
          // "http://127.0.0.1:5001/sedn-17b18/us-central1/getSednParameters",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ data: socketRouteRequest }),
          },
        );
        const socketRoute = (await socketRouteResponse.json()).result;
        console.log(
          "Socket Route",
          "https://us-central1-sedn-17b18.cloudfunctions.net/getSednParameters/",
          JSON.stringify({ data: socketRouteRequest }),
          JSON.stringify(socketRoute),
        );

        // create calldata dict
        const bungeeUserRequestDict = socketRoute.request;
        const bungeeBridgeAddress: string = socketRoute.bridgeAddress;
        const bungeeValue: BigInt = socketRoute.value;

        // stamping and sharing info
        const sednOriginBeforeWithdrawSigner = await sedn.balanceOf(useSigner.address);
        const usdcDestinationBeforeWithdrawSigner = await usdcDestination.balanceOf(useSigner.address);
        console.log(
          `ACCOUNTS: SednOrigin inital state (${network}:${useSigner.address}) ${
            sednOriginBeforeWithdrawSigner.toNumber() / decDivider
          }`,
        );

        // --------------------------
        // WITHDRAW
        // --------------------------
        if (gasless === true) {
          const response = await sendMetaTx(
            sedn,
            useSigner,
            useSigner.privateKey,
            "bridgeWithdraw",
            [amount, bungeeUserRequestDict, bungeeBridgeAddress],
            bungeeValue,
            relayers[ENVIRONMENT][network],
            config.forwarder[network],
          );
          const txHash = JSON.parse(response.result).txHash;
          console.log(`TX: Send tx: ${explorerUrl}/tx/${txHash}`);
          const txReceipt: any = await getTxReceipt(60_000, signer, txHash);
          console.log(`TX: Executed send tx with txHash: ${txHash} and blockHash: ${txReceipt.blockHash}`);
        } else {
          let fees = await feeData(network, signer);
          const tx = await sedn.connect(useSigner).bridgeWithdraw(amount, bungeeUserRequestDict, bungeeBridgeAddress, {
            maxFeePerGas: fees.maxFee,
            maxPriorityFeePerGas: fees.maxPriorityFee,
          });
          console.log(`TX: Send tx: ${explorerUrl}/tx/${tx.hash}`);
          const receipt = await tx.wait();
          console.log("TX: executed send tx", await getTxCostInUSD(receipt, nativeAssetId));
        }
        console.log("TX: Executed claim");

        // wait for shit to happen
        await waitTillRecipientBalanceIncreased(
          50 * 60_000,
          usdcDestination,
          destinationRecipient,
          usdcDestinationBeforeWithdrawSigner,
          decDivider,
          destinationNetwork,
        );
        const usdcDestinationAfterWithdrawSigner = await usdcDestination.balanceOf(destinationRecipient.address);
        console.log(
          `ACCOUNTS: RecipientDestination balance after 'claim' (${destinationNetwork}:${
            destinationRecipient.address
          }) ${usdcDestinationAfterWithdrawSigner.toNumber() / decDivider}`,
        );
        const claimedAmount =
          usdcDestinationAfterWithdrawSigner.sub(usdcDestinationBeforeWithdrawSigner).toNumber() / decDivider;
        const bridgeFees = amount / decDivider - claimedAmount;
        console.log(
          `INFO: Claimed ${claimedAmount} with bridge fees of ${bridgeFees} (${
            (bridgeFees / (amount / decDivider)) * 100
          }%). Sent ${amount / decDivider} and received ${claimedAmount}`,
        );
      });
    });
  });
});

const waitTillRecipientBalanceIncreased = async (
  maxTimeMs: number,
  usdcDestination: Contract,
  recipient: Wallet,
  initialBalance: BigNumber,
  decDivider: number,
  recipientNetwork: string,
) => {
  let startDate = new Date().getTime();

  const executePoll = async (resolve, reject) => {
    const newBalance = await usdcDestination.balanceOf(recipient.address);
    const elapsedTimeMs = new Date().getTime() - startDate;

    const claimed = newBalance.sub(initialBalance).toNumber();
    if (claimed > 0) {
      return resolve(claimed);
    } else if (elapsedTimeMs > maxTimeMs) {
      return reject(new Error(`Exchange took too long to complete. Max time: ${maxTimeMs}ms`));
    } else {
      console.log(
        `Waiting for recipient balance to increase. Elapsed time: ${elapsedTimeMs}ms. ${recipientNetwork}:${
          recipient.address
        } balance: ${newBalance.toNumber() / decDivider}`,
      );
      setTimeout(executePoll, 10000, resolve, reject);
    }
  };

  return new Promise(executePoll);
};

const getTxReceipt = async (maxTimeMs: number, signer: Wallet, txHash: string) => {
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

const getTxCostInUSD = async (receipt: any, assetId: string) => {
  const ether = ethers.utils.formatEther(receipt.effectiveGasPrice.mul(receipt.gasUsed)); // 1 ether = 10^18 Wei, all networks supported by socket have 10^18 Wei in their fee currency, even BSC BNB
  console.log("INFO: tx ether value", ether);
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${assetId}&vs_currencies=usd`;
  const priceData = await fetch(url).then(reponse => reponse.json());
  const actualDollarValue = parseFloat(ether) * priceData[assetId].usd;
  return actualDollarValue.toString() + " USD";
};

const checkTxStatus = async (receipt: TransactionReceipt) => {
  const logs = receipt.logs || [];
  if (typeof logs === "undefined" || logs.length === 0) {
    throw new Error("Transaction xecuted, but reverted");
  }
};
