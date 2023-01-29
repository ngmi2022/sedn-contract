import { SignTypedDataVersion, signTypedData } from "@metamask/eth-sig-util";
import { fetch } from "cross-fetch";
import { Contract, Signer, Wallet, ethers } from "ethers";

import { ForwarderAbi } from "../abis/abis";
import { explorerData, feeData, getChainId, getTxCostInUSD, getTxReceipt } from "./utils";

const EIP712Domain = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "verifyingContract", type: "address" },
];

const ForwardRequest = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "chainid", type: "uint256" },
  { name: "value", type: "uint256" },
  { name: "gas", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "data", type: "bytes" },
];

function getMetaTxTypeData(verifyingContract: string) {
  return {
    types: {
      EIP712Domain,
      ForwardRequest,
    },
    domain: {
      name: "SednForwarder",
      version: "0.0.1",
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
  const typeData = getMetaTxTypeData(forwarder.address);
  return { ...typeData, message: request };
}

export async function signMetaTxRequest(privateKey: string, forwarder: Contract, input: { [key: string]: string }) {
  const request = await buildRequest(forwarder, input);
  const toSign = await buildTypedData(forwarder, request);
  console.log("toSign: ", JSON.stringify(toSign));
  const BufferPk: Buffer = Buffer.from(privateKey.replace(/^0x/, ""), "hex");
  const signature = signTypedData({ privateKey: BufferPk, data: toSign, version: SignTypedDataVersion.V4 });
  return { signature, request };
}

export async function getSignedTxRequest(
  sednContract: Contract,
  signer: Signer,
  signerKey: string,
  funcName: string,
  funcArgs: any[],
  txValue: BigInt,
  chainid: string,
  forwarderAddress: string,
) {
  const forwarder = new ethers.Contract(forwarderAddress, ForwarderAbi, signer);
  const from = await signer.getAddress();
  const data = sednContract.interface.encodeFunctionData(funcName, funcArgs);
  const to = sednContract.address;
  const value = txValue.toString();

  const request = await signMetaTxRequest(signerKey, forwarder, { to, from, chainid, data, value });
  return request;
}

export async function sendMetaTx(
  sednContract: Contract,
  signer: Signer,
  signerKey: string,
  funcName: string,
  funcArgs: any[],
  txValue: BigInt,
  chainId: string,
  relayerWebhook: string,
  forwarderAddress: string,
) {
  const request = await getSignedTxRequest(
    sednContract,
    signer,
    signerKey,
    funcName,
    funcArgs,
    txValue,
    chainId,
    forwarderAddress,
  );
  console.log("DEBUG: request: ", request);
  console.log("DEBUG: sending request via webhook: ", relayerWebhook);
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
  let chainId: string = getChainId(network);
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
      chainId,
      relayerWebhook,
      forwarderAddress,
    );
    console.log("DEBUG: response from webhook: ", response);
    txHash = JSON.parse(response.result).txHash;
    console.log(`TX: Send gasless tx: ${explorerData[network].url}/tx/${txHash}`);
    txReceipt = await getTxReceipt(60_000, signer, txHash);
  } else {
    let fees = await feeData(network, signer);
    const lenfuncArgs = funcArgs.push({ maxFeePerGas: fees.maxFee, maxPriorityFeePerGas: fees.maxPriorityFee });
    const tx = await contract.connect(signer).functions[funcName](...funcArgs);
    txHash = tx.hash;
    console.log(`TX: Send tx: ${explorerData[network].url}/tx/${txHash}`);
    txReceipt = await tx.wait();
  }
  console.log(`TX: Executed send tx with txHash: ${txHash}`);
  console.log(`TX: Dollar cost: ${await getTxCostInUSD(txReceipt, network)}`);
  return txReceipt;
}

module.exports = {
  signMetaTxRequest,
  getSignedTxRequest,
  buildRequest,
  buildTypedData,
  sendMetaTx,
  sendTx,
};
