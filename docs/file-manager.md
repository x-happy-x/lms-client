# Файловый менеджер LMS (LMSC-18 / LMS-17)

Раздел работает с нодой напрямую через подписанный API, без копий файлов на роутере.

- `GET /api/ui/nodes/{id}/storage/targets`: доступные корни и свободное место.
- `GET /api/ui/nodes/{id}/files?root=…&path=…`: папка, относительные пути и метаданные.
- `GET/HEAD /api/ui/nodes/{id}/files/content?root=…&path=…&inline=1`: streaming/Range.
- `POST /api/ui/nodes/{id}/files/mkdir {root,path,name}`: новая папка внутри path.
- `POST /api/ui/nodes/{id}/files/rename {root,path,name}`: новое имя одного объекта.
- `POST /api/ui/nodes/{id}/files/delete {root,path}`: файл или пустая папка, без рекурсии.

Browse response:
```json
{"root":"/mnt/disk8tb","path":"Video","parentPath":"","entries":[{"name":"lesson.mp4","path":"Video/lesson.mp4","directory":false,"sizeBytes":1000000,"modifiedAt":"2026-11-11T08:00:00Z","mimeType":"video/mp4"}],"truncated":false}
```

Viewer может смотреть/скачивать. Editor/admin могут создавать папки, переименовывать
и удалять с подтверждением. Исключение для editor ограничено тремя точными file
routes; управление нодами по-прежнему admin-only. Сохранены Origin/CSRF проверки.
Скрытые файлы и симлинки не выдаются; выбор корня и каждый сегмент проверяет нода.
Корни нельзя переименовать/удалить, существующие файлы не перезаписываются.
Файлы текущих загрузок защищены; для finished jobs нода обновляет outputPath при rename.
Удаление непустой папки возвращает 409. Upload не добавлен: существующий upload API
используется внутренним переносом заданий и имеет другие правила перезаписи.

## Встраивание в новый shell

Импорт `FilesPage` из `components/files/FilesPage`, добавить TabKey `files` и пункт
навигации с иконкой folder; render `<FilesPage nodes={nodes} onChanged={refreshJobs} />`.
App.tsx оставлен агенту общего дизайна. CSS компонента импортируется им самостоятельно.
Контракты общие с нативным Android LMSA-1. API совместим со старыми нодами: unsupported
возвращается как ошибка обновления, обычные job endpoints не меняются.

## Проверка

Go test/vet; strict TypeScript; локальные Node Java-тесты безопасности/Range/HEAD/операций.
Изолированный Edge: папки, breadcrumbs, поиск, create/rename/delete confirmation,
viewer/editor, длинные имена, обе темы, ширина390 без горизонтального скролла.
Проверялся отдельный синтетический каталог, живые пользовательские файлы не менялись.
