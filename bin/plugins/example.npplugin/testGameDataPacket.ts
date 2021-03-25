import { MessageReader, MessageWriter } from "@nodepolus/framework/src/util/hazelMessage";
import { BaseGameDataPacket } from "@nodepolus/framework/src/protocol/packets/gameData";

export class TestGameDataPacket extends BaseGameDataPacket {
  constructor(
    public readonly message: string,
  ) {
    super(0x50);
  }

  static deserialize(reader: MessageReader): TestGameDataPacket {
    return new TestGameDataPacket(reader.readString());
  }

  clone(): TestGameDataPacket {
    return new TestGameDataPacket(this.message);
  }

  serialize(writer: MessageWriter): void {
    writer.writeString(this.message);
  }
}
