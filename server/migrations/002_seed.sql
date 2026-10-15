-- Dados iniciais editáveis pelo painel (nada disso é fixo no código).
insert into playlists (id, name, description)
values ('00000000-0000-4000-8000-00000000f001', 'Segurança POP',
        'Toca quando nenhuma regra se aplica. Coloque aqui conteúdo institucional que sempre pode ir ao ar.');

insert into organizations (id, name, fallback_playlist_id)
values (1, 'POP Vegan Food', '00000000-0000-4000-8000-00000000f001');

insert into units (id, name, city, state, timezone)
values ('00000000-0000-4000-8000-0000000c0501', 'Consolação', 'São Paulo', 'SP', 'America/Sao_Paulo');

insert into environments (unit_id, name, sort_order) values
  ('00000000-0000-4000-8000-0000000c0501', 'Salão', 1),
  ('00000000-0000-4000-8000-0000000c0501', 'Entrada', 2),
  ('00000000-0000-4000-8000-0000000c0501', 'Caixa', 3);

insert into collections (name, sort_order) values
  ('Campanhas', 1), ('Almoço POP', 2), ('Burger POP', 3), ('Pizzaria', 4),
  ('Institucional', 5), ('Ações sociais', 6), ('Promoções', 7), ('Datas comemorativas', 8);
