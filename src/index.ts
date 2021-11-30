import net from "net"

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

function requestCkey(cert: string, domain: string): Promise<UserInfo> {
  return new Promise((resolve, reject) => {
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
      console.debug("BYOND Hub says goodbye!")
      reject(Error("BYOND closed connection"))
    })
    socket.on("connect", () => {
      console.debug("Socket open, Hello BYOND?")
    })

    function socketError(error: unknown): never {
      socket.end()
      state = SocketState.Error
      reject(error)
      throw error
    }

    function receiveMsg(type: number, data: Buffer) {
      console.debug("BYOND says:", packetTypes[type] ? packetTypes[type] : type.toString(16), data)
      switch (type) {
        case 0x42: {
          key = data.readUInt32LE(12)
          console.debug("Key for socket is", key.toString(16))

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

          console.debug("Sending SendLookupCgiCertMsg to BYOND Hub with data", dataBuffer.toString())
          socket.write(packetBuffer)
          break
        }
        case 0x43: {
          if (!key) socketError(Error("The key's gone PLAID sir"))

          const decryptedData = Decode(data, key)
          const valid = !!decryptedData[0]
          const decodedData = new TextDecoder().decode(decryptedData.slice(1, -1))
          const parsedData = Object.fromEntries(
            new URLSearchParams(
              decodedData.replace("&", "%26").replace(";", "&")
            )
          )
          console.debug("Userinfo:", valid, parsedData)
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
          socketError("Invalid response packet type")
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
            console.debug("Awaiting more header data")
            return
          }

          dataBuffer = Buffer.alloc(getPacketLength())
          state = SocketState.ExpectData

          if (data.length > 4) {
            processData(data.slice(4))
          }
          break
        case SocketState.ExpectData:
          if (!dataBuffer) socketError(Error("dataBuffer is somehow lasagna"))

          if (data.copy(dataBuffer, dataPointer) < data.length) socketError(Error("data is larger than length"))

          dataPointer += data.length

          if (dataPointer === dataBuffer.length) {
            receiveMsg(headerBuffer.readUInt16BE(0), dataBuffer)
            //Full reset
            reset()
          }

          break
        case SocketState.Error:
          throw Error("Socket is errored")
      }
    }

    socket.on("data", processData)
    socket.on("error", error => {
      console.error("THE FLOOR IS LAVA, SOCKET ERROR", error)
      socketError("Socket entered error state")
    })
    socket.on("read", () => {
      console.debug("Socket is ready, plz talk")
    })
    socket.on("timeout", () => {
      console.debug("I'm bored, can we close this connection already?")
      socketError("BYOND did not respond in the allocated time")
    })
    socket.connect(6001, "hub.byond.com")
  })
}
export { requestCkey, Decode, Encode, packetTypes }