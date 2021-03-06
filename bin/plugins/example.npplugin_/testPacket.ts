import { MessageReader, MessageWriter } from "@nodepolus/framework/src/util/hazelMessage";
import { BaseRootPacket } from "@nodepolus/framework/src/protocol/packets/root";

export class TestPacket extends BaseRootPacket {
  constructor(
    public readonly message: string,
  ) {
    super(0x40);
  }

  static deserialize(reader: MessageReader): TestPacket {
    return new TestPacket(reader.readString());
  }

  clone(): TestPacket {
    return new TestPacket(this.message);
  }

  serialize(writer: MessageWriter): void {
    writer.writeString(this.message);
  }
}
