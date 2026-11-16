import axios from "axios";

const instancia = axios.create({ baseURL: "http://usuarios:8080" });

export default instancia;
