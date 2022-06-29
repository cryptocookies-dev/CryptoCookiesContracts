import { deployCookieHolder } from "./common";


deployCookieHolder([["BUSD"], ["0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56"]]).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
