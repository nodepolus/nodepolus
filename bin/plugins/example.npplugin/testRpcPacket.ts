import { MessageReader, MessageWriter } from "../../../src/util/hazelMessage";
import { BaseRpcPacket } from "../../../src/protocol/packets/rpc";

export class TestRpcPacket extends BaseRpcPacket {
  constructor(
    public readonly message: string,
  ) {
    super(0x60);
  }

  static deserialize(reader: MessageReader): TestRpcPacket {
    return new TestRpcPacket(reader.readString());
  }

  clone(): TestRpcPacket {
    return new TestRpcPacket(this.message);
  }

  serialize(writer: MessageWriter): void {
    writer.writeString(this.message);
  }
}
