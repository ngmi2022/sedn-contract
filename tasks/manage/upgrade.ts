import { getConfig, multiNetworkUpgrade } from ".";

async function upgrade(buildUid: string) {
  const build = await multiNetworkUpgrade(buildUid);
  console.log("finished upgrade");
}

upgrade("6ba141e7-05a9-4c9c-9d26-2c4bc49d1d15");
