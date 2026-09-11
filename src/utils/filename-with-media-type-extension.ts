export default (
  filename: string | undefined,
  mediaType: string,
): string | undefined => {
  const lastDot = filename?.lastIndexOf('.') ?? -1
  const extension = mediaType === 'image/jpeg' ? 'jpg' : mediaType.split('/')[1]
  if (!filename || lastDot <= 0 || !extension) {
    return filename
  }
  return `${filename.slice(0, lastDot)}.${extension}`
}
