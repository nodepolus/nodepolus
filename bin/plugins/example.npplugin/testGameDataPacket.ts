import { MessageReader, MessageWriter } from "../../../src/util/hazelMessage";
import { BaseGameDataPacket } from "../../../src/protocol/packets/gameData";

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
