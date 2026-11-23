import * as grpc from "@grpc/grpc-js";
import * as loader from "@grpc/proto-loader";
import { descontar } from "./inventario";

const definicion = loader.loadSync("../../proto/pedidos.proto");
const proto = grpc.loadPackageDefinition(definicion) as any;

export function reservar(call: { request: { id: string } }, responder: (e: null, r: object) => void) {
  descontar(call.request.id);
  responder(null, { id: call.request.id });
}

export function arrancar() {
  const server = new grpc.Server();
  server.addService(proto.pedidos.v1.Stock.service, { reservar });
  server.bindAsync("0.0.0.0:50051", grpc.ServerCredentials.createInsecure(), () => server.start());
}
