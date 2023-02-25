import { transferOwnershipToMultiSig } from ".";

const buildUid = "f25a3a0e-c6c2-4fb8-bd57-d9fe43ef86e7";

async function transfer(buildUid: string) {
  await transferOwnershipToMultiSig(buildUid);
  console.log("finished transfer");
}

transfer(buildUid);
