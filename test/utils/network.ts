import { ethers } from "hardhat";

export const takeSnapshot = async (): Promise<number> => {
  const result = await send("evm_snapshot");
  await mineBlock();
  return result;
};

export const restoreSnapshot = async (id: number) => {
  await send("evm_revert", [id]);
  await mineBlock();
};

export const mineBlock = () => {
  return send("evm_mine", []);
};

export const send = (method: string, params?: Array<any>) => {
  return ethers.provider.send(method, params === undefined ? [] : params);
};

export const setTimeNextBlock = async (time: number) => {
  await send("evm_setNextBlockTimestamp", [time]);
  await mineBlock();
};
