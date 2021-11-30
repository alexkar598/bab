import {requestCkey} from "@alexkar598/bab-hub"

async function main() {
  const invalidCert = "123456789012345678901234"
  console.log(await requestCkey(invalidCert, "localhost"))
}
main().catch(error => {
  console.error("An error occured!", error)
})