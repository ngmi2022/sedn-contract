import { multiNetworkUpgrade } from ".";

async function upgrade(buildUid: string) {
  const build = await multiNetworkUpgrade(buildUid);
  console.log("finished upgrade");
}

upgrade("f25a3a0e-c6c2-4fb8-bd57-d9fe43ef86e7");

// Latest config deployment: 6ba141e7-05a9-4c9c-9d26-2c4bc49d1d15
