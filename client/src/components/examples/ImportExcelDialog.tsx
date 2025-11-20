import { ImportExcelDialog } from '../import-excel-dialog';

export default function ImportExcelDialogExample() {
  return (
    <div className="p-6">
      <ImportExcelDialog onImport={(file) => console.log('Importing:', file.name)} />
    </div>
  );
}
