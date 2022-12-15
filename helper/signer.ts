import { SignTypedDataVersion, signTypedData } from "@metamask/eth-sig-util";
import { fetch } from "cross-fetch";
import { Contract, Signer, Wallet, ethers } from "ethers";

import { ForwarderAbi } from "../abis/abis";
import { explorerData, feeData, getTxCostInUSD, getTxReceipt } from "./utils";

const EIP712Domain = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

const ForwardRequest = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "gas", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "data", type: "bytes" },
];

function getMetaTxTypeData(chainId: number, verifyingContract: string) {
  return {
    types: {
      EIP712Domain,
      ForwardRequest,
    },
    domain: {
      name: "MinimalForwarder",
      version: "0.0.1",
      chainId,
      verifyingContract,
    },
    primaryType: "ForwardRequest",
  };
}

async function buildRequest(forwarder: ethers.Contract, input: { [key: string]: any }) {
  const nonce = await forwarder.getNonce(input.from).then(nonce => nonce.toString());
  return { value: 0, gas: 1e6, nonce, ...input };
}

async function buildTypedData(forwarder: ethers.Contract, request: { [key: string]: any }) {
  const chainId: number = await forwarder.provider.getNetwork().then(n => n.chainId);
  const typeData = getMetaTxTypeData(chainId, forwarder.address);
  return { ...typeData, message: request };
}

export async function signMetaTxRequest(privateKey: string, forwarder: Contract, input: { [key: string]: string }) {
  const request = await buildRequest(forwarder, input);
  const toSign = await buildTypedData(forwarder, request);
  const BufferPk: Buffer = Buffer.from(privateKey.replace(/^0x/, ""), "hex");
  const signature = signTypedData({ privateKey: BufferPk, data: toSign, version: SignTypedDataVersion.V4 });
  return { signature, request };
}

export async function sendMetaTx(
  sednContract: Contract,
  signer: Signer,
  signerKey: string,
  funcName: string,
  funcArgs: any[],
  txValue: BigInt,
  relayerWebhook: string,
  forwarderAddress: string,
) {
  if (!relayerWebhook) throw new Error(`Missing relayer webhook url`);

  const forwarder = new ethers.Contract(forwarderAddress, ForwarderAbi, signer);
  const from = await signer.getAddress();
  const data = sednContract.interface.encodeFunctionData(funcName, funcArgs);
  const to = sednContract.address;
  const value = txValue.toString();

  const request = await signMetaTxRequest(signerKey, forwarder, { to, from, data, value });
  const response = await fetch(relayerWebhook, {
    method: "POST",
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json", "Accept-Encoding": "identity" },
  }).then(function (res) {
    return res.json();
  });
  return response;
}

export async function sendTx(
  contract: Contract,
  signer: Wallet,
  signerKey: string,
  funcName: string,
  funcArgs: any[],
  txValue: BigInt,
  network: string,
  gasless: boolean,
  relayerWebhook?: string,
  forwarderAddress?: string,
) {
  let txReceipt: any = null;
  let txHash: string = "";
  if (gasless) {
    if (!relayerWebhook) throw new Error(`Missing relayer webhook url`);
    if (!forwarderAddress) throw new Error(`Missing forwarder address`);
    const response = await sendMetaTx(
      contract,
      signer,
      signerKey,
      funcName,
      funcArgs,
      txValue,
      relayerWebhook,
      forwarderAddress,
    );
    txHash = JSON.parse(response.result).txHash;
    console.log(`TX: Send gasless tx: ${explorerData[network].url}/tx/${txHash}`);
    txReceipt = await getTxReceipt(60_000, signer, txHash);
    console.log(`TX: Executed send tx with txHash: ${txHash} and blockHash: ${txReceipt.blockHash}`);
  } else {
    let fees = await feeData(network, signer);
    const lenfuncArgs = funcArgs.push({ maxFeePerGas: fees.maxFee, maxPriorityFeePerGas: fees.maxPriorityFee });
    const tx = await contract.connect(signer).functions[funcName](...funcArgs);
    txHash = tx.hash;
    console.log(`TX: Send tx: ${explorerData[network].url}/tx/${txHash}`);
    txReceipt = await tx.wait();
  }
  console.log(`TX: Executed send tx with txHash: ${txHash} and blockHash: ${txReceipt.blockHash}`);
  console.log(`TX: Cost: ${await getTxCostInUSD(txReceipt, network)}`);
  return txReceipt;
}

module.exports = {
  signMetaTxRequest,
  buildRequest,
  buildTypedData,
  sendMetaTx,
  sendTx,
};
