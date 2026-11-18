import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { esquemaParser, leerRepo, type Extraccion } from "../src/index.js";

/**
 * Un repo sintético con el esquema declarado de todas las formas que FlowBrain reconoce sin SQL: modelos de cada ORM,
 * migraciones como código y tipos de Kysely. Cada tabla tiene un nombre distinto para ver de dónde salió.
 */
let dir: string;
const w = async (ruta: string, lineas: string[]) => {
  await mkdir(dirname(join(dir, ruta)), { recursive: true });
  await writeFile(join(dir, ruta), lineas.join("\n") + "\n");
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-orm-"));
  await Promise.all([
    w("package.json", ['{ "name": "orm" }']),
    // TypeORM
    w("src/pedido.entity.ts", [
      'import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm";',
      '@Entity("pedidos")',
      "export class Pedido {",
      "  @PrimaryGeneratedColumn()",
      "  id: number;",
      '  @Column({ type: "varchar", length: 80, nullable: true })',
      "  nota: string | null;",
      "  @Column()",
      "  total: number;",
      "  @ManyToOne(() => Cliente)",
      '  @JoinColumn({ name: "cliente_id" })',
      "  cliente: Cliente;",
      "  calcular(): number {",
      "    const x: number = 1;",
      "    return x;",
      "  }",
      "}",
    ]),
    // MikroORM, sin nombre de tabla: la clase en snake_case.
    w("src/linea-pedido.ts", [
      "@Entity()",
      "export class LineaPedido {",
      "  @PrimaryKey() id!: number;",
      "  @Property({ nullable: true }) descripcion?: string;",
      "}",
    ]),
    // sequelize-typescript
    w("src/producto.model.ts", [
      'import { Table, Column, Model, DataType, PrimaryKey, AllowNull } from "sequelize-typescript";',
      '@Table({ tableName: "productos" })',
      "export class Producto extends Model {",
      "  @PrimaryKey @Column(DataType.INTEGER) id: number;",
      "  @AllowNull(false) @Column(DataType.STRING) nombre: string;",
      "}",
    ]),
    // Sequelize clásico
    w("models/cupon.js", [
      "module.exports = (sequelize, DataTypes) => sequelize.define('Cupon', {",
      "  codigo: { type: DataTypes.STRING, allowNull: false, primaryKey: true },",
      "  descuento: DataTypes.DECIMAL,",
      "}, { tableName: 'cupones' });",
    ]),
    // Mongoose, y Mongoose de Nest
    w("src/usuario.js", [
      "const mongoose = require('mongoose');",
      "const usuarioSchema = new mongoose.Schema({",
      "  email: { type: String, required: true },",
      "  roles: [String],",
      "  perfil: { nombre: String },",
      "});",
      "module.exports = mongoose.model('Usuario', usuarioSchema);",
    ]),
    w("src/sesion.schema.ts", [
      'import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";',
      "@Schema({ collection: 'sesiones' })",
      "export class Sesion {",
      "  @Prop({ required: true }) token: string;",
      "  @Prop() expira?: Date;",
      "}",
    ]),
    // Drizzle
    w("db/schema.ts", [
      'import { pgTable, serial, text, integer } from "drizzle-orm/pg-core";',
      "export const envios = pgTable('envios', {",
      "  id: serial('id').primaryKey(),",
      "  direccion: text('direccion').notNull(),",
      "  pisoNumero: integer('piso'),",
      "});",
    ]),
    // Knex: crea, después altera; el down no cuenta.
    w("migrations/20240101_facturas.js", [
      "exports.up = (knex) => knex.schema.createTable('facturas', (t) => {",
      "  t.increments('id');",
      "  t.string('numero').notNullable();",
      "  t.timestamps();",
      "});",
      "exports.down = (knex) => knex.schema.dropTable('facturas');",
    ]),
    w("migrations/20240202_facturas_cae.js", [
      "exports.up = function (knex) { return knex.schema.alterTable('facturas', function (t) { t.string('cae'); t.dropColumn('updated_at'); }); };",
      "exports.down = function (knex) { return knex.schema.alterTable('facturas', function (t) { t.dropColumn('cae'); }); };",
    ]),
    // Laravel
    w("database/migrations/2024_01_01_000000_create_equipos_table.php", [
      "<?php",
      "return new class extends Migration {",
      "  public function up(): void {",
      "    Schema::create('equipos', function (Blueprint $table) {",
      "      $table->id();",
      "      $table->string('nombre', 120);",
      "      $table->foreignId('club_id')->constrained();",
      "      $table->string('escudo')->nullable();",
      "      $table->timestamps();",
      "    });",
      "  }",
      "  public function down(): void { Schema::dropIfExists('equipos'); }",
      "};",
    ]),
    // Doctrine
    w("src/Entity/Jugador.php", [
      "<?php",
      "use Doctrine\\ORM\\Mapping as ORM;",
      "#[ORM\\Entity]",
      "#[ORM\\Table(name: 'jugadores')]",
      "class Jugador {",
      "    #[ORM\\Id]",
      "    #[ORM\\Column(type: 'integer')]",
      "    private int $id;",
      "    #[ORM\\Column(type: 'string', length: 255, nullable: true)]",
      "    private ?string $apodo;",
      "    #[ORM\\ManyToOne(targetEntity: Equipo::class)]",
      "    #[ORM\\JoinColumn(name: 'equipo_id')]",
      "    private Equipo $equipo;",
      "}",
    ]),
    // JPA
    w("src/main/java/Arbitro.java", [
      "@Entity",
      '@Table(name = "arbitros")',
      "public class Arbitro {",
      "  @Id @GeneratedValue private Long id;",
      '  @Column(name = "nombre_completo", nullable = false) private String nombreCompleto;',
      "  private Integer partidos;",
      "  @OneToMany private List<Partido> dirigidos;",
      "  private static final long serialVersionUID = 1L;",
      "}",
    ]),
    // GORM
    w("internal/sede.go", [
      "type Sede struct {",
      "  gorm.Model",
      '  Nombre string `gorm:"not null"`',
      "  Capacidad *int",
      "}",
    ]),
    // Django
    w("torneos/models.py", [
      "from django.db import models",
      "class Torneo(models.Model):",
      "    nombre = models.CharField(max_length=100)",
      "    sede = models.ForeignKey('Sede', on_delete=models.CASCADE, null=True)",
      "class Base(models.Model):",
      "    class Meta:",
      "        abstract = True",
    ]),
    // SQLAlchemy
    w("app/modelos.py", [
      "from sqlalchemy.orm import Mapped, mapped_column",
      "from sqlalchemy import Column, Integer, String",
      "class Entrada(Base):",
      "    __tablename__ = 'entradas'",
      "    id: Mapped[int] = mapped_column(primary_key=True)",
      "    sector: Mapped[Optional[str]] = mapped_column(String(10))",
      "    precio = Column(Integer, nullable=False)",
    ]),
    // Rails, con rollback que no cuenta
    w("db/migrate/20240101000000_create_abonos.rb", [
      "class CreateAbonos < ActiveRecord::Migration[7.1]",
      "  def up",
      "    create_table :abonos do |t|",
      '      t.string :titular, null: false',
      "      t.references :socio",
      "      t.timestamps",
      "    end",
      "  end",
      "  def down",
      "    drop_table :abonos",
      "  end",
      "end",
    ]),
    // Kysely
    w("src/db.d.ts", [
      'import type { ColumnType } from "kysely";',
      "export interface Sponsors {",
      "  id: Generated<number>;",
      "  /** nombre comercial */",
      "  marca: string;",
      '  nivel: "oro" | "plata" | null;',
      "}",
      "export interface DB {",
      "  sponsors: Sponsors;",
      "}",
    ]),
    // Un modelo de la misma tabla que una migración: gana la migración.
    w("src/equipo.entity.ts", ['@Entity("equipos")', "export class Equipo {", "  @Column() inventada: string;", "}"]),
  ]);
}, 60_000);
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("esquema desde ORMs y migraciones como código", () => {
  it("lee cada forma, con el nombre de tabla de la declaración o de la convención del ORM", () => {
    const x = esquemaParser.extract(leerRepo(dir)) as Extraccion;
    const t = Object.fromEntries((x.esquema ?? []).map((e) => [e.tabla, e.columnas.map((c) => `${c.nombre} ${c.tipo}${c.pk ? " pk" : ""}${c.nulo ? " null" : ""}`).join(" | ")]));
    expect(t).toEqual({
      pedidos: "id number pk | nota varchar null | total number | cliente_id fk",
      linea_pedido: "id number pk | descripcion string null",
      productos: "id integer pk | nombre string",
      cupones: "codigo string pk | descuento decimal null",
      usuarios: "_id ObjectId pk | email String | roles array null | perfil object null",
      sesiones: "_id ObjectId pk | token string | expira Date null",
      envios: "id serial pk | direccion text | piso integer null",
      facturas: "id increments pk | numero string | created_at timestamp null | cae string null",
      equipos: "id bigint pk | nombre string | club_id fk | escudo string null | created_at timestamp null | updated_at timestamp null",
      jugadores: "id integer pk | apodo string null | equipo_id fk",
      arbitros: "id Long pk | nombre_completo String | partidos Integer null",
      sedes: "id uint pk | created_at time.Time null | updated_at time.Time null | deleted_at gorm.DeletedAt null | nombre string | capacidad int null",
      torneos_torneo: "id AutoField pk | nombre CharField | sede_id fk null",
      entradas: "id int pk | sector String null | precio Integer",
      abonos: "id bigint pk | titular string | socio_id fk null | created_at datetime | updated_at datetime",
      sponsors: "id number | marca string | nivel enum(oro, plata) null",
    });
    // La línea apunta a la declaración.
    expect((x.esquema ?? []).find((e) => e.tabla === "pedidos")).toMatchObject({ archivo: "src/pedido.entity.ts", linea: 2 });
    expect((x.esquema ?? []).find((e) => e.tabla === "sponsors")).toMatchObject({ archivo: "src/db.d.ts", linea: 2 });
  });
});
