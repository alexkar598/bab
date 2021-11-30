/// <reference types="node" />
declare function Encode(data: Buffer, key: number): Buffer;
declare function Decode(data: Buffer, key: number): Buffer;
export declare type UserInfo = {
    key: string;
    gender: string;
    valid: true;
} | {
    valid: false;
    error: string;
};
declare const packetTypes: Record<number, string | undefined>;
declare function requestCkey(cert: string, domain: string): Promise<UserInfo>;
export { requestCkey, Decode, Encode, packetTypes };
