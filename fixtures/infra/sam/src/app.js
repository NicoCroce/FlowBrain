exports.listar = async () => ({ statusCode: 200, body: "[]" });

module.exports.crear = async (evento) => ({ statusCode: 201, body: evento.body });

exports.consumir = async (evento) => evento.Records.length;
