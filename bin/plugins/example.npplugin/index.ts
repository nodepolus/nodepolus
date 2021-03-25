import { FileAnnouncementDriver } from "../../../src/announcementServer/drivers";
import { BaseInnerNetObject } from "../../../src/protocol/entities/baseEntity";
import { ConnectionInfo, DisconnectReason, Vector2 } from "../../../src/types";
import { MessageReader, MessageWriter } from "../../../src/util/hazelMessage";
import { AddressFamily, InnerNetObjectType } from "../../../src/types/enums";
import { AnnouncementServer } from "../../../src/announcementServer";
import { BasePlugin, PluginMetadata } from "../../../src/api/plugin";
import { GameDataPacket } from "../../../src/protocol/packets/root";
import { RpcPacket } from "../../../src/protocol/packets/gameData";
import { PlayerJoinedEvent } from "../../../src/api/events/player";
import { RootPacket } from "../../../src/protocol/packets/hazel";
import { Connection } from "../../../src/protocol/connection";
import { shuffleArrayClone } from "../../../src/util/shuffle";
import { TestGameDataPacket } from "./testGameDataPacket";
import { TestRpcPacket } from "./testRpcPacket";
import { Hmac } from "../../../src/util/hmac";
import { TestPacket } from "./testPacket";
import path from "path";
import {
  ServerLobbyJoinEvent,
  ServerPacketInCustomEvent,
  ServerPacketInGameDataCustomEvent,
  ServerPacketInRpcCustomEvent,
} from "../../../src/api/events/server";

/**
 * Grab the server and announcement server from the global object.
 */
declare const announcementServer: AnnouncementServer;

/**
 * Define the plugin's metadata.
 */
const pluginMeta: PluginMetadata = {
  name: "Test Plugin",
  version: [1, 2, 3],
};

// DEBUG
type User = {
  token: string;
  name: string;
};

// DEBUG
const KICK_UNAUTHENTICATED = process.env.NP_KICK_UNAUTHENTICATED !== undefined;
const AUTHENTICATION_BYTE = 0x69;
const CLIENT_ID_BYTE_LENGTH = 16;
const HASH_BYTE_LENGTH = 20;
const AUTHENTICATION_HEADER_LENGTH = 1 + CLIENT_ID_BYTE_LENGTH + HASH_BYTE_LENGTH;
const USERS: Map<string, User> = new Map([
  [
    "ec4435dfe404482b8e8a0946e12a9f9a",
    {
      token: "3a6adcf92fec282614f9a77b9ad5d24bcacab84522631eaa789c05090156ca5135a4753236142993",
      name: "Cody",
    },
  ],
  [
    "fc54bb9de1434234986b7bd873e93c86",
    {
      token: "07f34399f3162ad5baf871f41646259e7b9d8cebb045b6e4648222de0cb38fe1b9a28bc177794648",
      name: "Rose",
    },
  ],
  [
    "3af27ba3f117422fb399093a1393ec0e",
    {
      token: "5848db9438bf15b53703e00b4b37fa1df7088002e197a7bb6b8b241c403691a9faf13364b32d72b4",
      name: "Sanae",
    },
  ],
]);

/**
 * Export the plugin as the default export.
 */
export default class extends BasePlugin {
  constructor() {
    super(pluginMeta);

    /**
     * Registers a custom root packet with the ID 0x40 (64).
     */
    RootPacket.registerPacket(
      0x40,
      TestPacket.deserialize,
      this.handleTestPacket.bind(this),
    );

    /**
     * Registers a custom GameData packet with the ID 0x50 (80).
     */
    GameDataPacket.registerPacket(
      0x50,
      TestGameDataPacket.deserialize,
      this.handleTestGameDataPacket.bind(this),
    );

    /**
     * Registers a custom RPC packet with the ID 0x60 (96).
     */
    RpcPacket.registerPacket(
      0x60,
      TestRpcPacket.deserialize,
      this.handleTestRpcPacket.bind(this),
    );

    // this.server.on("server.packet.out", event => {
    //   if (event.getPacket().getType() === RootPacketType.GetGameList) {
    //     event.cancel();
    //   }
    // });

    // this.server.on("server.packet.out.gamedata", event => {
    //   if (event.getPacket().getType() === GameDataPacketType.Spawn) {
    //     event.cancel();
    //   }
    // });

    // this.server.on("server.packet.out.rpc", event => {
    //   if (event.getPacket().getType() === RpcPacketType.SendChat) {
    //     event.cancel();
    //   }
    // });

    /**
     * Sets the inbound packet transformer to one that authenticates packets
     * prefixed with a marker byte, client ID, and packet HMAC.
     */
    this.server.setInboundPacketTransformer((connection: Connection, reader: MessageReader): MessageReader => {
      if (reader.peek(0) != AUTHENTICATION_BYTE) {
        if (KICK_UNAUTHENTICATED) {
          connection.disconnect(DisconnectReason.custom("This server does not supported unauthenticated packets"));

          return new MessageReader();
        }

        return reader;
      }

      if (reader.getLength() < AUTHENTICATION_HEADER_LENGTH) {
        connection.disconnect(DisconnectReason.custom("Invalid packet length"));

        return new MessageReader();
      }

      if (reader.getLength() == AUTHENTICATION_HEADER_LENGTH) {
        // Short circuit since the packet has no body
        return new MessageReader();
      }

      reader.readByte();

      const clientId = reader.readBytes(CLIENT_ID_BYTE_LENGTH).getBuffer().toString("hex");
      const user = USERS.get(clientId);

      if (user === undefined) {
        connection.disconnect(DisconnectReason.custom("Unknown user"));

        return new MessageReader();
      }

      const hash = reader.readBytes(HASH_BYTE_LENGTH).getBuffer().toString("hex");
      const message = reader.readRemainingBytes();

      if (!Hmac.verify(message.getBuffer().toString("hex"), hash, user.token)) {
        connection.disconnect(DisconnectReason.custom("Signature mismatch"));

        return new MessageReader();
      }

      if (connection.hasMeta("clientId")) {
        if (connection.getMeta<string>("clientId") !== clientId) {
          connection.disconnect(DisconnectReason.custom("Wrong connection for user"));

          return new MessageReader();
        }
      } else {
        connection.setMeta({ clientId });
      }

      // Set other meta like purchases, display name, friends, etc:
      // connection.setMeta({
      //   friends: db.getFriends(clientId),
      //   purchases: db.getPurchases(clientId),
      // });

      this.getLogger().info("Authenticated packet from %s on connection %s: %s", user.name, connection, message);

      return message;
    });

    /**
     * Register some event handlers.
     */
    this.server.on("server.ready", this.demoLogger.bind(this));
    this.server.on("player.joined", this.logPlayerJoins.bind(this));
    this.server.on("server.lobby.join", this.joinRandomLobby.bind(this));

    /**
     * Listens for custom root packets
     */
    this.server.on("server.packet.in.custom", (event: ServerPacketInCustomEvent) => {
      event.cancel();

      const packet = event.getPacket();
      const lobby = event.getConnection().getLobby();

      if (lobby !== undefined) {
        this.server.getLogger("Custom Packet").debug(
          "Received custom root packet from connection %s in lobby %s: %s",
          event.getConnection(),
          lobby,
          packet,
        );
      } else {
        this.server.getLogger("Custom Packet").debug(
          "Received custom root packet from connection %s: %s",
          event.getConnection(),
          packet,
        );
      }
    });

    /**
     * Listens for custom GameData packets
     */
    this.server.on("server.packet.in.gamedata.custom", (event: ServerPacketInGameDataCustomEvent) => {
      event.cancel();

      const packet = event.getPacket();

      this.server.getLogger("Custom GameData").debug(
        "Received custom GameData packet from lobby %s: %s",
        event.getConnection().getLobby(),
        packet,
      );
    });

    /**
     * Listens for custom RPC packets
     */
    this.server.on("server.packet.in.rpc.custom", (event: ServerPacketInRpcCustomEvent) => {
      event.cancel();

      const packet = event.getPacket();
      const sender = event.getSender();

      if (sender === undefined) {
        return;
      }

      this.server.getLogger("Custom RPC").debug(
        "Received custom RPC packet from %s object #%d: %s",
        InnerNetObjectType[sender.getType()],
        event.getNetId(),
        packet,
      );
    });

    /**
     * Set the announcement server's driver.
     */
    announcementServer.setDriver(new FileAnnouncementDriver(path.join(__dirname, "announcement.json")));
  }

  /**
   * Demonstrates log levels and object printing.
   */
  private demoLogger(): void {
    const meta = {
      some: "property",
    };

    /**
     * Use `%s` to print a value as a string, or `%d` to print a value as a
     * number. Extra arguments that don't have a corresponding `%s` or `%d` will
     * be logged as metadata at the end of the message.
     */
    this.getLogger().fatal("Test message 1", meta);
    this.getLogger().error("Test message 2", meta);
    this.getLogger().warn("Test message 3", meta);
    this.getLogger().info("Test message 4", meta);
    this.getLogger().info("Test message %d", 5, meta);
    this.getLogger().verbose("Test message 6", meta);
    this.getLogger().debug("Test message 7", meta);
    this.getLogger().debug("Number: %d", 42);
    this.getLogger().debug("BigInt: %d", 42n);
    this.getLogger().debug("Decimal: %d", 4.2);
    this.getLogger().debug("String: %s", "42");
    this.getLogger().debug("Boolean as string: %s", true);
    this.getLogger().debug("Boolean as number: %d", true);
    this.getLogger().debug("undefined: %s", undefined);
    this.getLogger().debug("Symbol: %s", Symbol("test"));
    this.getLogger().debug("Vector2: %s", new Vector2(1.234, 5.678));

    const [clientId, { token }] = [...USERS.entries()][0];
    const message = new MessageWriter()
      .writeByte(0x01)
      .writeUInt16(0x08)
      .startMessage(0x40)
      .writeString("this is a signed message")
      .endMessage();
    const info = {
      address: "127.0.0.1",
      family: "IPv4",
      port: 42069,
      size: -1,
    };

    // DEBUG: Simulates sending a TestPacket packet from a connection
    this.server.getSocket().emit(
      "message",
      new MessageWriter()
        .writeByte(0x01)
        .writeUInt16(0x07, true)
        .startMessage(0x40)
        .writeString("hello world")
        .endMessage()
        .getBuffer(),
      info,
    );

    // DEBUG: Simulates sending an authenticated TestPacket packet from a connection
    this.server.getSocket().emit(
      "message",
      new MessageWriter()
        .writeByte(0x69)
        .writeBytes(Buffer.from(clientId, "hex"))
        .writeBytes(Buffer.from(Hmac.sign(message.getBuffer().toString("hex"), token), "hex"))
        .writeBytes(message)
        .getBuffer(),
      info,
    );

    this.server.getConnection(new ConnectionInfo("127.0.0.1", 42069, AddressFamily.IPv4)).disconnect(DisconnectReason.serverRequest(), true);
  }

  /**
   * Logs when a player joins a lobby.
   */
  private logPlayerJoins(event: PlayerJoinedEvent): void {
    this.getLogger().info(
      "%s connected to lobby %s from connection %s",
      event.getPlayer(),
      event.getLobby(),
      event.getPlayer().getConnection(),
    );

    // DEBUG: Simulates sending a TestPacket packet from a connection in a lobby
    // event.getPlayer().getConnection()?.emit("message", MessageReader.fromRawBytes([
    //   0x01, 0x00, 0x07, 0x06, 0x00, 0x40, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f,
    // ]));

    // DEBUG: Simulates sending a TestGameDataPacket packet
    // event.getPlayer().getConnection()?.emit("message", MessageReader.fromRawBytes([
    //   0x01, 0x00, 0x08, 0x0d, 0x00, 0x05, 0x9a, 0xa0, 0xb6, 0x80, 0x06, 0x00, 0x50, 0x05, 0x77, 0x6f, 0x72, 0x6c, 0x64,
    // ]));

    // DEBUG: Simulates sending a TestRpcPacket packet
    // event.getPlayer().getConnection()?.emit("message", MessageReader.fromRawBytes([
    //   0x01, 0x00, 0x08, 0x0f, 0x00, 0x05, 0x9a, 0xa0, 0xb6, 0x80, 0x08, 0x00, 0x02, 0x04, 0x60, 0x05, 0x61, 0x67, 0x61, 0x69, 0x6e,
    // ]));
  }

  /**
   * Lets players join a random public lobby by joining with the code "RANDOM".
   */
  private joinRandomLobby(event: ServerLobbyJoinEvent): void {
    if (event.getLobbyCode() !== "RANDOM") {
      return;
    }

    /**
     * Grab a random non-full public lobby.
     */
    const lobby = shuffleArrayClone(
      this.server.getLobbies().filter(lob => !lob.isFull() && lob.isPublic()),
    )[0];

    event.setLobby(lobby);
  }

  /**
   * This method will only be called if the `event.cancel()` call in the
   * `server.packet.in.custom` event handler is removed.
   */
  private handleTestPacket(connection: Connection, packet: TestPacket): void {
    const lobby = connection.getLobby();

    if (lobby !== undefined) {
      this.server.getLogger("TestPacket").debug(
        "Received TestPacket from connection %s in lobby %s: %s",
        connection,
        lobby,
        packet.message,
      );
    } else {
      this.server.getLogger("TestPacket").debug(
        "Received TestPacket from connection %s: %s",
        connection,
        packet.message,
      );
    }
  }

  /**
   * This method will only be called if the `event.cancel()` call in the
   * `server.packet.in.gamedata.custom` event handler is removed.
   */
  private handleTestGameDataPacket(connection: Connection, packet: TestGameDataPacket): void {
    this.server.getLogger("TestGameDataPacket").debug(
      "Received TestGameDataPacket from connection %s for lobby %s: %s",
      connection,
      connection.getLobby(),
      packet.message,
    );
  }

  /**
   * This method will only be called if the `event.cancel()` call in the
   * `server.packet.in.rpc.custom` event handler is removed.
   */
  private handleTestRpcPacket(connection: Connection, packet: TestRpcPacket, sender?: BaseInnerNetObject): void {
    if (sender === undefined) {
      return;
    }

    if (sender.getType() !== InnerNetObjectType.PlayerControl) {
      return;
    }

    this.server.getLogger("TestRpcPacket").debug(
      "Received TestRpcPacket from connection %s (%s object #%d): %s",
      connection,
      InnerNetObjectType[sender.getType()],
      sender.getNetId(),
      packet.message,
    );

    // (sender as InnerPlayerControl).setName(packet.message, connection.lobby?.getConnections() ?? []);
  }
}
