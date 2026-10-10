'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Save, X, AlertCircle } from 'lucide-react'

export interface ColumnSchema {
  cid: number
  name: string
  type: string
  notNull: boolean
  defaultValue: string | null
  primaryKey: boolean
}

interface RowEditorModalProps {
  open: boolean
  onClose: () => void
  schema: ColumnSchema[]
  initialRow?: Record<string, unknown> | null
  mode: 'insert' | 'update'
  onSave: (values: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
}

export function RowEditorModal({
  open,
  onClose,
  schema,
  initialRow,
  mode,
  onSave,
}: RowEditorModalProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [nulls, setNulls] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(false)

  // Initialize/reset form state when modal opens (false → true transition)
  if (open && !wasOpen) {
    setWasOpen(true)
    const newValues: Record<string, string> = {}
    const newNulls: Record<string, boolean> = {}

    for (const col of schema) {
      if (mode === 'insert') {
        newValues[col.name] = col.defaultValue ?? ''
        newNulls[col.name] = col.defaultValue === null && !col.notNull
      } else {
        const val = initialRow?.[col.name]
        if (val === null || val === undefined) {
          newValues[col.name] = ''
          newNulls[col.name] = true
        } else if (typeof val === 'object') {
          newValues[col.name] = JSON.stringify(val)
          newNulls[col.name] = false
        } else {
          newValues[col.name] = String(val)
          newNulls[col.name] = false
        }
      }
    }

    setValues(newValues)
    setNulls(newNulls)
    setError(null)
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  useEffect(() => {
    return () => {
      setWasOpen(false)
    }
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)

    const finalValues: Record<string, unknown> = {}
    for (const col of schema) {
      if (nulls[col.name]) {
        finalValues[col.name] = null
      } else {
        const raw = values[col.name] ?? ''
        // تحويل النوع
        const type = col.type.toUpperCase()
        if (raw === '' && !col.notNull) {
          finalValues[col.name] = null
        } else if (type.includes('INT')) {
          finalValues[col.name] = raw === '' ? 0 : parseInt(raw, 10)
        } else if (type.includes('REAL') || type.includes('FLOAT') || type.includes('DOUBLE')) {
          finalValues[col.name] = raw === '' ? 0 : parseFloat(raw)
        } else if (type.includes('BOOL')) {
          finalValues[col.name] = raw === 'true' || raw === '1' ? 1 : 0
        } else {
          finalValues[col.name] = raw
        }
      }
    }

    const result = await onSave(finalValues)
    setSaving(false)
    if (result.success) {
      onClose()
    } else {
      setError(result.error || 'فشل الحفظ')
    }
  }

  const renderInput = (col: ColumnSchema) => {
    const type = col.type.toUpperCase()
    const isNull = nulls[col.name]

    if (isNull) {
      return (
        <div className="flex items-center justify-center h-9 px-3 rounded-md border border-dashed border-muted-foreground/30 text-muted-foreground text-sm">
          NULL
        </div>
      )
    }

    // JSON / TEXT كبير
    if (type.includes('JSON') || (type.includes('TEXT') && col.name.includes('json'))) {
      return (
        <Textarea
          value={values[col.name] ?? ''}
          onChange={(e) => setValues({ ...values, [col.name]: e.target.value })}
          className="font-mono text-xs min-h-[100px]"
          placeholder='{"key": "value"}'
        />
      )
    }

    // TEXT كبير (analysis, narrative, story)
    if (type.includes('TEXT') && (col.name.includes('analysis') || col.name.includes('narrative') || col.name.includes('story'))) {
      return (
        <Textarea
          value={values[col.name] ?? ''}
          onChange={(e) => setValues({ ...values, [col.name]: e.target.value })}
          className="min-h-[80px]"
        />
      )
    }

    // Boolean
    if (type.includes('BOOL') || (type.includes('INT') && col.name.startsWith('is_'))) {
      return (
        <Select
          value={values[col.name] ?? '0'}
          onValueChange={(v) => setValues({ ...values, [col.name]: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">false (0)</SelectItem>
            <SelectItem value="1">true (1)</SelectItem>
          </SelectContent>
        </Select>
      )
    }

    // Integer
    if (type.includes('INT')) {
      return (
        <Input
          type="number"
          value={values[col.name] ?? ''}
          onChange={(e) => setValues({ ...values, [col.name]: e.target.value })}
          placeholder="0"
        />
      )
    }

    // Float
    if (type.includes('REAL') || type.includes('FLOAT') || type.includes('DOUBLE')) {
      return (
        <Input
          type="number"
          step="0.01"
          value={values[col.name] ?? ''}
          onChange={(e) => setValues({ ...values, [col.name]: e.target.value })}
          placeholder="0.00"
        />
      )
    }

    // Default: text
    return (
      <Input
        value={values[col.name] ?? ''}
        onChange={(e) => setValues({ ...values, [col.name]: e.target.value })}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'insert' ? '➕ إدراج صف جديد' : '✏️ تعديل الصف'}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-3">
            {schema.map((col) => (
              <div key={col.name} className="grid grid-cols-[200px_1fr_auto] gap-3 items-start">
                <div className="space-y-1">
                  <Label className="text-xs font-mono">
                    {col.name}
                    {col.primaryKey && (
                      <Badge variant="secondary" className="ml-1 text-[10px]">PK</Badge>
                    )}
                    {col.notNull && (
                      <Badge variant="outline" className="ml-1 text-[10px] text-red-500">NOT NULL</Badge>
                    )}
                  </Label>
                  <div className="text-[10px] text-muted-foreground font-mono">{col.type || 'TEXT'}</div>
                </div>

                <div>
                  {renderInput(col)}
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Label className="text-[10px] text-muted-foreground">NULL</Label>
                  <Switch
                    checked={nulls[col.name]}
                    onCheckedChange={(checked) =>
                      setNulls({ ...nulls, [col.name]: checked })
                    }
                    disabled={col.notNull}
                  />
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-red-700 dark:text-red-300 font-mono break-all">
              {error}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            <X className="h-4 w-4 mr-1" />
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            {mode === 'insert' ? 'إدراج' : 'حفظ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
