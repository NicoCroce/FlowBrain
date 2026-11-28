/** El número del botón «Agente» de la barra (dec. 236): lo que espera a la persona; "" si no hay nada. */
export const cuentaAgente = (bandeja: string): string => /class="pd-cuenta"[^>]*>([^<]*)</.exec(bandeja)?.[1] ?? "";
