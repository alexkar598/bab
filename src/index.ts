import net from "net"
import debug from "debug"

function Encode(data: Buffer, key: number): Buffer {
  let checksum = Buffer.alloc(1)
  let returnBuf = Buffer.alloc(data.length + 1)

  data.forEach((byte, idx) => {
    returnBuf[idx] = byte + (checksum[0] + (key >> (checksum[0] % 32)))
    checksum[0] += byte
  })
  returnBuf[returnBuf.length - 1] = checksum[0]
  return returnBuf
}

function Decode(data: Buffer, key: number): Buffer {
  let checksum = Buffer.alloc(1)
  let returnBuf = Buffer.alloc(data.length - 1)

  data.forEach((byte, idx) => {
    if (idx === data.length - 1) return

    let decodedByte = byte - (checksum[0] + (key >> (checksum[0] % 32)))
    returnBuf[idx] = decodedByte
    checksum[0] += decodedByte
  })

  if (data[data.length - 1] !== checksum[0]) {
    console.error(`Checksum mismatch. Expected ${data[data.length - 1]} Got ${checksum[0].toString(16)}`)
    throw Error("Unable to decode, checksum mismatch")
  }

  return returnBuf
}

export type UserInfo = {
  key: string
  gender: string
  valid: true
} | {
  valid: false
  error: string
}

const packetTypes: Record<number, string | undefined> = {
  0x42: "HelloMsg",
  0x4A: "SendLookupCgiCertMsg",
  0x43: "ResponseMsg"
}

let socketNumber = 0

function requestCkey(cert: string, domain: string): Promise<UserInfo> {
  const debugSocket = debug(`bab-hub:Socket${socketNumber++}`)
  debugSocket("Requesting Ckey | Cert: %s | Domain: %s", cert, domain)

  return new Promise((resolve, reject) => {
    if(cert.length != 24) {
      reject(Error(`Invalid cert size, expected 24, got ${cert.length}.`))
      return
    }

    const socket = new net.Socket()

    enum SocketState {
      ExpectHeader,
      ExpectData,
      Error
    }

    let state: SocketState = SocketState.ExpectHeader
    const headerBuffer = Buffer.alloc(4)
    let headerPointer = 0
    //const getPacketType = () => headerBuffer.readUInt16BE(0)
    const getPacketLength = () => headerBuffer.readUInt16BE(2)
    let dataBuffer: Buffer | null = null
    let dataPointer = 0
    let key: number | null = null

    socket.on("close", () => {
      debugSocket("BYOND Hub says goodbye!")
      reject(Error("HUB closed connection"))
    })
    socket.on("connect", () => {
      debugSocket("Socket open, Hello BYOND?")
    })

    function socketError(error: unknown) {
      socket.end()
      state = SocketState.Error
      reject(error)
    }

    function receiveMsg(type: number, data: Buffer) {
      debugSocket("Packet | Type %s | Data %o ", packetTypes[type] ? packetTypes[type] : type.toString(16), data)
      switch (type) {
        case 0x42: {
          key = data.readUInt32LE(12)
          debugSocket("Socket key received %s", key.toString(16))

          const certBuffer = new TextEncoder().encode(cert)
          const domainBuffer = new TextEncoder().encode(domain)

          //certLen, 1 for nullByte, domLen, 1 for nullByte
          const dataBuffer = Buffer.alloc(certBuffer.length + 1 + domainBuffer.length + 1)

          //2 type, 2 length, dataBuffer, 1 for checksum
          const packetBuffer = Buffer.alloc(4 + dataBuffer.length + 1)

          //Type: SendLookupCgiCertMsg
          packetBuffer.writeUInt16BE(0x4a, 0)
          //Length of dataBuffer + checksum byte
          packetBuffer.writeUInt16BE(dataBuffer.length + 1, 2)
          //Write certBuffer into dataBuffer
          Buffer.from(certBuffer).copy(dataBuffer, 0)
          //Write domainBuffer into dataBuffer after the nullByte
          Buffer.from(domainBuffer).copy(dataBuffer, certBuffer.length + 1)

          //Encrypt the dataBuffer and put it in the request
          Encode(dataBuffer, key).copy(packetBuffer, 4)

          debugSocket("Sending SendLookupCgiCertMsg %O", dataBuffer)
          socket.write(packetBuffer)
          break
        }
        case 0x43: {
          if (!key) return socketError(Error("The key's gone PLAID sir"))

          const decryptedData = Decode(data, key)
          const valid = !!decryptedData[0]
          const decodedData = new TextDecoder().decode(decryptedData.slice(1, -1))
          const parsedData = Object.fromEntries(
            new URLSearchParams(
              decodedData.replace("&", "%26").replace(";", "&")
            )
          )
          debugSocket("User Info | Valid: %o | Data: %s", valid, decodedData)
          if(valid) {
            resolve({
              valid: true,
              key: parsedData.key,
              gender: parsedData.gender
            })
          } else {
            resolve({
              valid: false,
              error: decodedData
            })
          }

          socket.end()
          break
        }
        default: {
          console.error("Unknown packet", type.toString(16), data)
          return socketError("Invalid response packet type")
        }
      }
    }

    function reset() {
      state = SocketState.ExpectHeader
      headerBuffer.fill(0)
      headerPointer = 0
      dataBuffer = null
      dataPointer = 0
    }

    function processData(data: Buffer) {
      switch (state) {
        case SocketState.ExpectHeader:
          const copiedBytes = data.copy(headerBuffer, headerPointer, 0, 4 - headerPointer)
          headerPointer += copiedBytes
          if (headerPointer < 4) {
            debugSocket("Awaiting more header data")
            return
          }

          dataBuffer = Buffer.alloc(getPacketLength())
          state = SocketState.ExpectData

          if (data.length > 4) {
            processData(data.slice(4))
          }
          break
        case SocketState.ExpectData:
          if (!dataBuffer) return socketError(Error("dataBuffer is somehow lasagna"))

          if (data.copy(dataBuffer, dataPointer) < data.length) return socketError(Error("data is larger than length"))

          dataPointer += data.length

          if (dataPointer === dataBuffer.length) {
            receiveMsg(headerBuffer.readUInt16BE(0), dataBuffer)
            //Full reset
            reset()
          } else {
            debugSocket("Awaiting more data")
          }

          break
        case SocketState.Error:
          throw Error("Socket is errored")
      }
    }

    socket.on("data", processData)
    socket.on("error", error => {
      console.error("Socket error", error)
      return socketError("Socket entered error state")
    })
    socket.on("ready", () => {
      debugSocket("Socket is ready")
    })
    socket.on("timeout", () => {
      debugSocket("Connection timeout")
      socket.end()
      return socketError("BYOND did not respond in the allocated time")
    })
    socket.connect(6001, "hub.byond.com")
    debugSocket("Opening connection")
  })
}
export { requestCkey, Decode, Encode, packetTypes }