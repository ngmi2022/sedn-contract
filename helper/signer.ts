import { SignTypedDataVersion, TypedMessage, recoverTypedSignature, signTypedData } from "@metamask/eth-sig-util";
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
  { name: "valid", type: "uint256" },
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
      version: "0.0.2",
      verifyingContract,
    },
    primaryType: "ForwardRequest",
  };
}

async function buildRequest(forwarder: ethers.Contract, input: { [key: string]: string | number }) {
  const nonce = await forwarder.getNonce(input.from).then(nonce => nonce.toString());
  return { value: 0, gas: 1e6, nonce, ...input };
}

function buildTypedData(forwarderAddress: string, request: { [key: string]: string | number }) {
  const typeData = getMetaTxTypeData(forwarderAddress);
  return { ...typeData, message: request } as TypedMessage<{
    EIP712Domain: { name: string; type: string }[];
    ForwardRequest: { name: string; type: string }[];
  }>;
}

export async function signMetaTxRequest(
  privateKey: string,
  forwarder: Contract,
  input: { [key: string]: string | number },
) {
  const request = await buildRequest(forwarder, input);
  const toSign = buildTypedData(forwarder.address, request);
  console.log("toSign: ", JSON.stringify(toSign));
  const BufferPk: Buffer = Buffer.from(privateKey.replace(/^0x/, ""), "hex");
  const signature = signTypedData({ privateKey: BufferPk, data: toSign, version: SignTypedDataVersion.V4 });
  console.log(
    "valid signature?:",
    checkSignature(signature, request, forwarder.address, new Wallet(privateKey).address),
  );
  return { signature, request };
}

export function checkSignature(signature: string, request: any, forwarderAddress: string, publicKey: string) {
  const typedData = buildTypedData(forwarderAddress, request);
  const publicKeyFromSignature = recoverTypedSignature({
    data: typedData,
    signature,
    version: SignTypedDataVersion.V4,
  });
  console.log("publicKey from Signature", publicKeyFromSignature);
  return publicKeyFromSignature === publicKey.toLowerCase();
}

export async function getSignedTxRequest(
  sednContract: Contract,
  signer: Signer,
  signerKey: string,
  funcName: string,
  funcArgs: any[],
  txValue: BigInt,
  chainId: number,
  validUntilTime: number,
  forwarderAddress: string,
) {
  const forwarder = new ethers.Contract(forwarderAddress, ForwarderAbi, signer);
  const from = await signer.getAddress();
  const data = sednContract.interface.encodeFunctionData(funcName, funcArgs);
  const to = sednContract.address;
  const value = txValue.toString();
  const valid = validUntilTime.toString();
  const chainid = chainId.toString();

  const request = await signMetaTxRequest(signerKey, forwarder, { to, from, chainid, data, valid, value });
  return request;
}

export async function sendMetaTx(
  sednContract: Contract,
  signer: Signer,
  signerKey: string,
  funcName: string,
  funcArgs: any[],
  txValue: BigInt,
  chainId: number,
  validUntilTime: number,
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
    validUntilTime,
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
  validUntilTime: number,
  gasless: boolean,
  relayerWebhook?: string,
  forwarderAddress?: string,
) {
  let txReceipt: any = null;
  let txHash: string = "";
  let chainId = parseInt(getChainId(network));
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
      validUntilTime,
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
