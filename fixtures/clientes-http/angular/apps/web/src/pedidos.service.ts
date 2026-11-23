import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { environment } from "./environment";

export interface NuevoPedido {
  productoId: string;
  cantidad: number;
}

export interface Pedido {
  id: string;
  estado: string;
  total: number;
}

export interface Filtro {
  pagina: number;
}

@Injectable({ providedIn: "root" })
export class PedidosService {
  private readonly base = environment.apiUrl;
  constructor(private http: HttpClient) {}

  listar(f: Filtro) {
    return this.http.get<Pedido[]>(`${this.base}/pedidos`, { params: f });
  }
  ver(id: string) {
    return this.http.get<Pedido>(`${this.base}/pedidos/${id}`);
  }
  crear(p: NuevoPedido) {
    return this.http.post<Pedido>(`${this.base}/pedidos`, p);
  }
  borrar(id: string) {
    return this.http.delete(`${this.base}/pedidos/${id}`);
  }
  cancelar(id: string) {
    return this.http.request("PUT", `${this.base}/pedidos/${id}`, { body: { estado: "cancelado" } });
  }
}

@Injectable({ providedIn: "root" })
export class SaludService {
  private http = inject(HttpClient);
  private map = new Map<string, string>();

  salud() {
    return this.http.get("/api/salud");
  }
  armada(destino: () => string) {
    return this.http.get(destino());
  }
  noEsHttp() {
    return this.map.get("x");
  }
}
