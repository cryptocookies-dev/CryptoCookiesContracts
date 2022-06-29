import { deployCookieHolder } from "./common";

deployCookieHolder([["USDC"], ["0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"]]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
