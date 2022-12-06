const { AutotaskClient } = require('defender-autotask-client');

const ENVIRONMENT = process.env.ENVIRONMENT;

const autotaskIds = {
    'prod': ["507b3f04-18d3-41ab-9484-701a01fc2ffe", "8e4e19b7-0103-4552-ab68-3646966ab186", "ce515ed3-d267-4654-8843-e9fe7047c05d"],
    'staging': ["ee577506-d647-4919-819e-bbe70e60f58c", "dba1d31c-cae3-4205-9786-5c2cf22c46af", "2d858f46-cc71-4628-af9f-efade0f6b1df"]
};

async function uploadCode(autotaskId, apiKey, apiSecret) {
    const client = new AutotaskClient({ apiKey, apiSecret });
    await client.updateCodeFromFolder(autotaskId, "./build/relay");
}

async function main() {
    require("dotenv").config();
    const { DEFENDER_TEAM_KEY: apiKey, DEFENDER_TEAM_SECRET: apiSecret } = process.env;
    var autotaskIdsLength = autotaskIds[ENVIRONMENT].length
    for (var i = 0; i < autotaskIdsLength; i++) {
        var autotaskId = autotaskIds[ENVIRONMENT][i]
        if (!autotaskId) throw new Error("Missing autotask id");
        if (!apiKey) throw new Error("Missing api key");
        if (!apiSecret) throw new Error("Missing api key");
        await uploadCode(autotaskId, apiKey, apiSecret);
        console.log("Code updated for ", autotaskId);
    };
    console.log('Code updated for all autotask ids')
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch(error => {
            console.error(error);
            process.exit(1);
        });
}
