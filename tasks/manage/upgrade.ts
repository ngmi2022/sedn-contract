import { multiNetworkUpgrade } from ".";

async function upgrade(buildUid: string) {
  const build = await multiNetworkUpgrade(buildUid);
  console.log("finished upgrade");
}

upgrade("6ba141e7-05a9-4c9c-9d26-2c4bc49d1d15");

// Latest config deployment: 6ba141e7-05a9-4c9c-9d26-2c4bc49d1d15
// arbitrum test deployment: 5abc7f01-eadd-4e55-9ced-feba4ba93ca6
